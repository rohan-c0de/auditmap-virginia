# ASSIST.org articulation API — schema reference

Phase 1 spike output for [issue #584](https://github.com/rohan-c0de/cc-coursemap/issues/584). Documents the endpoint flow and JSON shape returned by ASSIST.org's per-major articulation API, based on 50 sample fixtures committed to `scripts/ca/fixtures/articulation/` (10 CCs × 5 universities × 3 popular majors, 2025-26 academic year).

This is the spec Phase 2 (`scripts/ca/parse-assist-articulation.ts`) will build the parser against.

---

## 1. Endpoint flow

ASSIST uses an XSRF-protected REST API (no API key, public access after handshake). All `/api/*` requests must include the `X-XSRF-TOKEN` header echoing the cookie value set by `GET /`.

| # | Endpoint | Purpose |
|---|---|---|
| 1 | `GET /` | Sets `X-XSRF-TOKEN` cookie (session bootstrap) |
| 2 | `GET /api/institutions` | All 179 institutions (116 CCs + 63 universities) with assist IDs |
| 3 | `GET /api/AcademicYears` | Year IDs (current = 76 for 2025-26) |
| 4 | `GET /api/institutions/{sendingId}/agreements?academicYearId={ay}&receivingInstitutionId={recvId}` | Which institutions have agreements with this one in this year (returns institution list, not agreement keys) |
| 5 | `GET /api/agreementCategories?receivingInstitutionId={recvId}&sendingInstitutionId={sendId}&academicYearId={ay}` | Available report categories for this pair: `Major`, `Department`, `Prefix`, `General Education / Breadth` |
| 6 | `GET /api/agreements?receivingInstitutionId={recvId}&sendingInstitutionId={sendId}&academicYearId={ay}&categoryCode=major` | List of major reports with `{label, key, ownerInstitutionId}` |
| 7 | `GET /api/articulation/Agreements?Key={urlencoded-key}` | Full articulation report (4-220 KB JSON) |

**Agreement key format:** `{academicYearId}/{sendingInstitutionId}/to/{receivingInstitutionId}/{categoryLabel}/{uuid}`
Example: `76/137/to/117/Major/c2e22564-966f-4e45-1f6c-08ddcb96df9e`

---

## 2. Rate limiting

ASSIST returns **HTTP 429** after roughly **50 sustained 1-req/sec calls**. The 50 successful fixtures + 100 skipped calls in our Phase 1 run hit this exact pattern (see `scripts/ca/fixtures/articulation/_index.json`).

**v2 scraper requirements:**
- Exponential backoff on 429: wait 30s, 60s, 120s, 240s before giving up
- After backoff success, reduce baseline rate to 1 req / 2s
- Resumable cursor — never refetch what's already cached
- Probably need to chunk per (CC) and run as 116 separate jobs with hours between to dodge per-IP daily caps

---

## 3. Top-level response envelope

```jsonc
{
  "isSuccessful": true,
  "result": { /* see §4 */ },
  "validationFailure": null
}
```

When `isSuccessful: false`, `validationFailure` carries error details and `result` is null. We haven't seen a failure case in 50 fixtures; the v2 parser should defensively reject anything without `isSuccessful: true`.

---

## 4. `result` object — top-level fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name of the major, e.g. `"Computer Science and Engineering/B.S."` |
| `type` | string | Always `"Major"` for major reports |
| `publishDate` | ISO-8601 string | When ASSIST published this agreement |
| `academicYear` | **JSON string** | Must be `JSON.parse()`d again; contains `{id, code, beginDate, endDate, ...}` |
| `catalogYear` | **JSON string** | `{receivingCatalogYearBegin, receivingCatalogYearEnd, sendingCatalogYearBegin, sendingCatalogYearEnd}` |
| `receivingInstitution` | **JSON string** | `{id, code, isCommunityCollege, category, termType, names: [{name, ...}]}` |
| `sendingInstitution` | **JSON string** | Same shape as receivingInstitution |
| `templateAssets` | **JSON string** | Array of display-layout assets (see §5) |
| `articulations` | **JSON string** | Array of match data linking template cells to sending courses (see §6) |

### ⚠️ Quirk: nested JSON strings

Six fields inside `result` are themselves JSON strings, not parsed objects. After `await response.json()`, you still need a second pass:

```ts
const top = await resp.json();
const meta = {
  academicYear: JSON.parse(top.result.academicYear),
  catalogYear: JSON.parse(top.result.catalogYear),
  receivingInstitution: JSON.parse(top.result.receivingInstitution),
  sendingInstitution: JSON.parse(top.result.sendingInstitution),
};
const templateAssets = JSON.parse(top.result.templateAssets);
const articulations = JSON.parse(top.result.articulations);
```

The parser MUST handle this. It's not documented anywhere on the ASSIST site — we discovered it by inspection.

---

## 5. `templateAssets[]` — display/layout structure

What the receiving (UCLA/Berkeley/etc.) requirement *looks like* visually on the ASSIST website. Across our 50 fixtures, four types appear:

| Type | Count | Purpose |
|---|---|---|
| `RequirementGroup` | 161 | Container for receiving courses, with sections, rows, and instructions (`Complete all`, `Select N`, etc.) |
| `GeneralText` | 114 | Free-form display text (intro paragraphs, notes) |
| `GeneralTitle` | 93 | Section headings |
| `RequirementTitle` | 79 | Title for a requirement block |

### `RequirementGroup`

```jsonc
{
  "type": "RequirementGroup",
  "sections": [
    {
      "type": "Section",
      "rows": [
        {
          "position": 0,
          "cells": [
            {
              "type": "Course",
              "course": { /* receiving course details */ },
              "id": "5fd3297c-4ab5-4c9b-e783-08ddcb96dfae",  // ← templateCellId, links to articulations[]
              "position": 0
            }
          ]
        }
        // ... more rows
      ],
      "advisements": [],
      "position": 0
    }
  ],
  "instruction": {
    "type": "Following" | "Conjunction" | "NFromArea" | "NFromConjunction" | "NFromFollowing",
    "selectionType": "Complete" | "Select",
    "id": "b19d872f-dd5f-4f2a-687d-08ddcb96dfa1"
  },
  "groupId": "4dba6f45-6887-ef11-8474-000d3a37e3b6",
  "area": "Requirements",
  "position": 2
}
```

### Instruction taxonomy (across all fixtures)

| `instruction.type` / `selectionType` | Count | Meaning |
|---|---|---|
| `Following` / `Complete` | 56 | Take all of the following courses |
| `Conjunction` / `Complete` | 37 | Take all (AND between cells) |
| `null` / `""` | 29 | No explicit instruction (parser default: treat as "Complete") |
| `NFromConjunction` / `Complete` | 25 | Take N from the AND/OR group |
| `NFromArea` / `Complete` | 8 | Take N from this area |
| `Conjunction` / `Select` | 4 | Choose one (OR between cells) |
| `NFromFollowing` / `Complete` | 2 | Take N from the following |

When `selectionType` is `Select` or instruction is `NFrom*`, the requirement is "choose N of M" — the UI surface needs to render this as a picker, not a checklist.

---

## 6. `articulations[]` — the actual match data

Each entry links one receiving template cell (by `templateCellId`) to a sending-side course requirement.

```jsonc
{
  "templateCellId": "5fd3297c-4ab5-4c9b-e783-08ddcb96dfae",  // ← matches templateAssets[].sections[].rows[].cells[].id
  "articulation": {
    "type": "Course" | "Series" | "Requirement" | "GeneralEducation",
    "course": { /* present when type === "Course" */ },
    "series": { /* present when type === "Series" */ },
    "requirement": { /* present when type === "Requirement" */ },
    "sendingArticulation": {
      "noArticulationReason": null | "No Course Articulated" | "This course must be taken at the university after transfer",
      "deniedCourses": [],
      "items": [
        {
          "courseConjunction": "And" | "Or",
          "items": [ /* SENDING-side courses */ ],
          "type": "CourseGroup",
          "position": 0
        }
      ],
      "type": "SendingArticulation"
    }
  }
}
```

### Articulation `type` distribution (across 50 fixtures)

| Type | Count | Receiving side is… |
|---|---|---|
| `Course` | 478 | A single receiving course |
| `Series` | 29 | A named series of receiving courses (e.g., `"MCELLBI 32, MCELLBI 32L"` with `conjunction: "And"`) |
| `Requirement` | 28 | A named receiving requirement (e.g., `"Courses that satisfy the Level III Physics requirement for Engineering major only"`) |
| `GeneralEducation` | 7 | A GE area (IGETC / CSU GE Breadth) |

### Sending-side AND/OR logic

The sending side (CC courses that satisfy the receiving requirement) lives in `articulation.sendingArticulation.items[]`. Each top-level item has a `courseConjunction` (`And` or `Or`) and a nested `items[]` of actual courses.

Across our fixtures: **15 `And`, 1 `Or`** — most articulations require taking ALL the listed CC courses to satisfy the receiving requirement. `Or` is rare (alternative course paths to the same outcome).

### No-articulation cases

When `sendingArticulation.noArticulationReason` is non-null:

| Reason | Meaning |
|---|---|
| `"No Course Articulated"` | This receiving course has no equivalent at the sending CC. Student must take it after transfer. |
| `"This course must be taken at the university after transfer"` | Explicit policy — never articulates. |

When non-null, `items[]` is empty.

---

## 7. Sending course shape (inside `sendingArticulation.items[].items[]`)

```jsonc
{
  "type": "Course",
  "prefix": "ACCTG",
  "prefixParentId": 5779,
  "prefixDescription": "Accounting",
  "courseNumber": "1",
  "courseTitle": "Introduction to Financial Accounting",
  "courseIdentifierParentId": 281352,
  "departmentParentId": 88,
  "department": "Accounting",
  "begin": "F2012",
  "end": "",
  "minUnits": 5.0,
  "maxUnits": 5.0,
  "pathways": [],
  "publishedCourseIdentifierYearTermId": null,
  "position": 0,
  "visibleCrossListedCourses": [],
  "requisites": [],
  "attributes": []
}
```

Mapping to our existing `TransferMapping` schema:
- `cc_prefix` ← `prefix` (e.g., `"ACCTG"`)
- `cc_number` ← `courseNumber` (e.g., `"1"`)
- `cc_title` ← `courseTitle`
- `cc_credits` ← `maxUnits` (or `minUnits` if range)
- `begin` / `end` — course validity term range; `end: ""` means currently active

---

## 8. Draft TypeScript types for Phase 2

```ts
// Top-level envelope
export interface AssistApiResponse<T> {
  isSuccessful: boolean;
  result: T | null;
  validationFailure: string | null;
}

// Result, post-parse of nested JSON strings
export interface AssistArticulationResult {
  name: string;
  type: "Major" | "Department" | "Prefix" | "Breadth";
  publishDate: string;
  academicYear: AssistAcademicYear;
  catalogYear: AssistCatalogYear;
  receivingInstitution: AssistInstitutionMeta;
  sendingInstitution: AssistInstitutionMeta;
  templateAssets: AssistTemplateAsset[];
  articulations: AssistArticulation[];
}

export interface AssistAcademicYear {
  id: number;
  code: string;
  beginDate: string;
  endDate: string;
  isOpenForMaintenance: boolean;
  isOpenForPublic: boolean;
}

export interface AssistInstitutionMeta {
  id: number;
  code: string;
  isCommunityCollege: boolean;
  category: "UC" | "CSU" | "CCC" | string;
  termType: "Semester" | "Quarter";
  names: Array<{ name: string; hasDepartments: boolean }>;
}

export type AssistTemplateAsset =
  | RequirementGroupAsset
  | GeneralTextAsset
  | GeneralTitleAsset
  | RequirementTitleAsset;

export interface RequirementGroupAsset {
  type: "RequirementGroup";
  sections: Array<{
    rows: Array<{
      cells: Array<{
        type: "Course" | "Series" | "Requirement" | "GeneralEducation";
        course?: AssistCourse;
        id: string; // templateCellId, joins to articulations
      }>;
    }>;
  }>;
  instruction: {
    type: "Following" | "Conjunction" | "NFromArea" | "NFromConjunction" | "NFromFollowing" | null;
    selectionType: "Complete" | "Select" | "";
  } | null;
  groupId: string;
  area: string;
}

export interface AssistArticulation {
  templateCellId: string;
  articulation: {
    type: "Course" | "Series" | "Requirement" | "GeneralEducation";
    course?: AssistCourse;
    series?: { conjunction: "And" | "Or"; name: string; courses: AssistCourse[] };
    requirement?: { name: string };
    sendingArticulation: {
      noArticulationReason: string | null;
      deniedCourses: AssistCourse[];
      items: Array<{
        courseConjunction: "And" | "Or";
        type: "CourseGroup";
        items: AssistCourse[];
      }>;
      type: "SendingArticulation";
    };
  };
}

export interface AssistCourse {
  type: "Course";
  prefix: string;
  prefixDescription: string;
  courseNumber: string;
  courseTitle: string;
  courseIdentifierParentId: number;
  department: string;
  minUnits: number;
  maxUnits: number;
  begin: string;
  end: string;
}
```

---

## 9. Internal target schema (clean, denormalized)

What Phase 2 will normalize the above into, for storage in Supabase and consumption by the UI:

```ts
export interface ArticulationAgreement {
  cc_slug: string;
  university_slug: string;
  major_label: string;        // e.g., "Computer Science and Engineering/B.S."
  agreement_key: string;       // ASSIST's full key
  academic_year: string;       // "2025-2026"
  publish_date: string;
  receiving_termtype: "Semester" | "Quarter";
  requirement_groups: ArticulationRequirementGroup[];
}

export interface ArticulationRequirementGroup {
  area: string;                // e.g., "Requirements", "Preparation for the Major"
  instruction: "complete-all" | "select-one" | "n-from-area" | "n-from-conjunction" | null;
  n?: number;                  // for n-from-* instructions
  requirements: ArticulationRequirement[];
}

export interface ArticulationRequirement {
  receiving_type: "course" | "series" | "named" | "ge_area";
  receiving_label: string;     // course code or series/requirement name
  receiving_courses: SimpleCourse[];   // 1 for course, N for series, empty for named/ge
  sending: SendingOption[];    // alternative ways to satisfy
  no_articulation_reason: "no-course-articulated" | "post-transfer-only" | null;
}

export interface SendingOption {
  conjunction: "and" | "or";   // how courses in this option combine
  courses: SimpleCourse[];     // 1+ courses that together satisfy
}

export interface SimpleCourse {
  prefix: string;
  number: string;
  title: string;
  min_units: number;
  max_units: number;
}
```

---

## 10. Open questions for Phase 2

1. **GE area shape** — only 7 `GeneralEducation` type articulations in our fixtures, none of which I've inspected end-to-end yet. Phase 2 should pull a few more fixtures specifically from `categoryCode=breadth` to understand IGETC/CSU GE Breadth tagging.
2. **Cross-listed courses** — `visibleCrossListedCourses` and `requisites` are non-empty in some courses we haven't sampled deeply. Worth checking with STEM-heavy majors (bio with labs, engineering with prereqs).
3. **`templateOverrides`** — present on every articulation entry as an empty array. Unknown purpose; might carry per-CC exceptions to the receiving requirement.
4. **`pathways`** — empty in all our samples. ASSIST docs mention "transfer pathways" for ADT (Associate Degree for Transfer) — probably a separate category we'd query via the `pathways` endpoint family.
5. **Department / Prefix categories** — we only fetched `categoryCode=major`. Department reports (`dept`) and Prefix reports (`prefix`) are the same shape but answer different questions. Worth confirming before Phase 2 commits.

---

## 11. Files referenced

- Explorer script: [scripts/ca/explore-assist-articulation.ts](../scripts/ca/explore-assist-articulation.ts)
- Sample fixtures: [scripts/ca/fixtures/articulation/](../scripts/ca/fixtures/articulation/)
- Fixture index: [scripts/ca/fixtures/articulation/_index.json](../scripts/ca/fixtures/articulation/_index.json)
- Existing system-level scraper: [scripts/ca/scrape-transfer-assist.ts](../scripts/ca/scrape-transfer-assist.ts)
- v2 issue: [#584](https://github.com/rohan-c0de/coursemap/issues/584)
