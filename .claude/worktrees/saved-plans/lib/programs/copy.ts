/**
 * Hand-written intro copy and FAQ content per program slug, for the
 * /[state]/program/[slug] pages. Issue #413 priority #6 (content depth).
 *
 * Each program has:
 *   - `intro`: 2-paragraph SEO-friendly opener. Template variables
 *     ({stateName}, {systemName}, {totalColleges}, {totalSections},
 *     {ccName}) are interpolated at render time. Hand-written copy
 *     varies enough between programs that no two pages have identical
 *     boilerplate — important for Google not classifying as thin
 *     content / doorway pages.
 *   - `faq`: 4 questions and answers tailored to the program. Same
 *     template interpolation applies. Renders as <dl> + JSON-LD
 *     FAQPage schema for rich-result eligibility.
 *
 * Keep edits to this file additive — every entry has been written
 * specifically for SEO and student usefulness. If a program's
 * template would benefit from new variables, add them to
 * `renderTemplate` in the consumer rather than embedding state-
 * specific text here.
 */

export interface ProgramCopy {
  /** 2 paragraphs, each rendered as its own <p>. Template vars allowed. */
  intro: [string, string];
  faq: Array<{ q: string; a: string }>;
}

export const PROGRAM_COPY: Record<string, ProgramCopy> = {
  nursing: {
    intro: [
      "{stateName} community colleges are the most popular launchpad into nursing in the state — {totalColleges} {systemName} institutions offer the coursework and clinical hours required for the NCLEX-RN or NCLEX-PN exam, and many graduates step directly into staff-nurse roles at local hospitals without ever attending a four-year school. The associate degree in nursing (ADN) typically takes two years full-time; LPN programs run 12–18 months.",
      "This term, the {totalSections} sections across these {totalColleges} colleges span the full nursing pipeline: pre-nursing prerequisites like anatomy and microbiology, the clinical ADN sequence, and bridge-to-BSN pathways for nurses planning to continue toward a bachelor's. Programs vary in clinical site partnerships, NCLEX pass rates, and waitlist length, so it pays to compare each college's awards-per-year and graduate earnings below before choosing where to apply.",
    ],
    faq: [
      {
        q: "Can I become a registered nurse from a community college?",
        a: "Yes. An associate degree in nursing (ADN) from any accredited {stateName} community college qualifies you to sit for the NCLEX-RN exam — the same exam BSN graduates take. ADN-prepared RNs work in the same hospitals and earn the same starting wage as BSN-prepared RNs at most {stateName} employers, though some larger health systems prefer or require a BSN within 5 years of hire.",
      },
      {
        q: "How long does the nursing program take?",
        a: "The ADN is typically a 2-year full-time program (4 semesters of core nursing courses after prerequisites). Most {stateName} community colleges expect students to complete 1–2 semesters of prerequisites — anatomy, physiology, microbiology, English, statistics — before applying to the competitive nursing cohort, so the total time from first enrollment is often 3 years.",
      },
      {
        q: "Do nursing credits transfer to a bachelor's program?",
        a: "Yes. Every {systemName} ADN program has at least one RN-to-BSN bridge partnership with a four-year university — usually the closest state university. ADN graduates can typically complete the BSN online in 12–18 months while continuing to work as an RN, often with their employer covering tuition.",
      },
      {
        q: "What's the demand for nurses in {stateName}?",
        a: "Strong and growing. BLS projects RN employment to grow 6% nationally through 2032 — faster than the average occupation — and {stateName} faces the same aging-population pressure driving demand. Most {stateName} ADN graduates have job offers before completing the program; rural hospitals and long-term care facilities offer signing bonuses and tuition forgiveness to recruit RNs.",
      },
    ],
  },

  "business-administration": {
    intro: [
      "Business administration is the most-completed associate degree at {stateName} community colleges, and the most flexible — graduates step into operations and management roles at small businesses, transfer to four-year business schools, or use the degree as a foundation for an MBA. Across {totalColleges} {systemName} institutions, this term's {totalSections} sections cover management, marketing, finance, accounting, and economics — the same core curriculum a four-year business school would expect in years 1 and 2.",
      "The associate degree typically takes two years full-time and articulates cleanly to most {stateName} four-year business programs, so students can complete the first half of a BBA at community college tuition rates before transferring. Compare colleges below by award counts, online section availability, and graduate earnings to find the best fit.",
    ],
    faq: [
      {
        q: "Should I get an associate in business or transfer to a four-year school first?",
        a: "For most students, completing the associate first is cheaper — {stateName} community college tuition is a fraction of four-year tuition, and the first two years of a BBA are largely general-education and intro business courses that transfer 1:1. The exception is students aiming for elite business schools that prefer freshmen admits.",
      },
      {
        q: "What jobs can I get with an associate in business?",
        a: "Office manager, assistant manager, sales representative, account coordinator, bookkeeper, and administrative supervisor are common entry points. Many graduates use the degree to formalize an existing role they were promoted into — companies often cover or reimburse the associate's tuition for employees moving from hourly to salaried positions.",
      },
      {
        q: "Does business credit transfer to a {stateName} four-year university?",
        a: "Yes. Most {systemName} business associate programs are articulated to the major state university business school under a guaranteed-transfer agreement. Compare colleges below — some have stronger transfer partnerships than others, and the right college can save you a full semester at four-year tuition rates.",
      },
      {
        q: "How long does an associate in business take?",
        a: "Two years full-time (4 semesters of 15 credits each), or three to four years part-time. Many {stateName} programs offer evening and online sections specifically for working students completing the degree alongside a full-time job.",
      },
    ],
  },

  "computer-science": {
    intro: [
      "{stateName} community colleges offer two distinct CS pathways: an associate of applied science (AAS) for students aiming directly at help-desk, network admin, or junior developer roles, and a transfer-track AS that articulates to a bachelor's in computer science at a four-year school. The {totalSections} sections this term across {totalColleges} {systemName} institutions cover programming (Python, Java, JavaScript), data structures, networking, cybersecurity, and intro computer science theory.",
      "Two-year CC programs aren't a shortcut to a software engineering career — most SWE roles still require a bachelor's — but the IT-support, sysadmin, and cybersecurity-tech career paths absolutely start here. For students who want to be a software developer, the transfer-track AS lets you complete two years at community-college tuition before continuing to a CS bachelor's, with credit articulation in place at most {stateName} four-year programs.",
    ],
    faq: [
      {
        q: "Can I become a software engineer with an associate degree?",
        a: "Possible but uncommon. Most software engineering roles require a bachelor's in computer science or equivalent experience. The realistic CC-grad direct path is IT support / help desk → junior systems administrator → systems engineer, often with industry certifications (CompTIA Network+, Security+, AWS) earned alongside the degree.",
      },
      {
        q: "Does community college CS credit transfer to a CS bachelor's?",
        a: "Yes, if you pick the transfer-track AS rather than the career-track AAS. The two tracks share courses but have different math sequences — transfer-track requires Calculus I and II; AAS often uses applied math or business math. Confirm with your target four-year school's transfer office before enrolling.",
      },
      {
        q: "What programming languages do {stateName} community colleges teach?",
        a: "Python is dominant for intro courses and data-science tracks. Java is common in transfer-track CS sequences (mirroring what most four-year schools teach in their first two years). JavaScript appears in web-development AAS programs. C++ shows up in some game-dev and embedded-systems tracks. Check each college's catalog below for specifics.",
      },
      {
        q: "Is cybersecurity a good track at {stateName} CCs?",
        a: "Yes — it's one of the highest-employment direct-career paths from a CC. Most {stateName} community college cybersecurity programs are aligned with the NSA / DHS Center of Academic Excellence framework and prepare students for industry certifications like Security+ and CySA+. Graduates step into SOC analyst, junior pen-test, or IT-security-admin roles.",
      },
    ],
  },

  accounting: {
    intro: [
      "Accounting is one of the most direct community-college-to-career pathways in {stateName}: graduates with an associate in accounting step into bookkeeping, accounts payable/receivable, payroll, and entry-level staff accountant roles at small businesses and CPA firms across the state. The {totalSections} sections this term at {totalColleges} {systemName} colleges cover financial accounting, managerial accounting, tax prep, payroll, and QuickBooks.",
      "For students aiming at the CPA license, an associate's covers roughly the first two years of the 150-credit-hour requirement — the rest comes from a bachelor's in accounting plus enough upper-division coursework to hit the threshold. Compare college below by graduate earnings and award counts; some {systemName} programs have tighter articulation with university accounting programs than others.",
    ],
    faq: [
      {
        q: "Can I become a CPA with just an associate degree?",
        a: "No. The CPA license requires 150 college credit hours (typically a bachelor's plus 30 extra hours) — an associate is 60 hours. The associate is a great first step that covers the intro accounting sequence at much lower tuition, but you'll need to transfer to complete the bachelor's plus the extra credits.",
      },
      {
        q: "What's the difference between bookkeeping and accounting jobs?",
        a: "Bookkeepers record day-to-day transactions, manage AP/AR, and produce monthly trial balances. Accountants analyze the books, produce financial statements, handle tax compliance, and advise on financial decisions. An associate in accounting qualifies you for full-charge bookkeeper and staff-accountant roles; the higher-paying senior accountant and controller titles typically require a bachelor's.",
      },
      {
        q: "Does {stateName} have a high demand for accountants?",
        a: "Yes. Accounting is one of the most stable, highest-employment occupations in every state — every business needs at least one bookkeeper, and the field is largely recession-resistant because tax compliance and AP/AR don't go away in downturns. BLS projects 4% employment growth nationally through 2032.",
      },
      {
        q: "Does accounting credit transfer to a bachelor's in accounting?",
        a: "Yes, with the usual caveats — both colleges (CC and 4-year) must use the AICPA model curriculum for the credits to fully apply toward the upper-division accounting major. {stateName}'s {systemName} accounting programs are generally well-articulated with the state's flagship universities. Compare colleges below; articulation strength varies.",
      },
    ],
  },

  "early-childhood-education": {
    intro: [
      "{stateName} community colleges train the people who staff licensed daycare centers, preschools, Head Start programs, and pre-K classrooms across the state. The {totalSections} sections at {totalColleges} {systemName} institutions this term cover child development, early-literacy methods, classroom management for ages 0–5, family engagement, and the supervised practicum hours required for the state's child-care or T-K teaching credentials.",
      "Most {stateName} ECE associate programs are designed for working students — evening and weekend sections are standard — because the typical student is already employed at a child-care center and using the degree to move into a lead-teacher or assistant-director role. Pay is modest but the work is stable and the credentialing pathway is clearer than almost any other field.",
    ],
    faq: [
      {
        q: "Do I need a degree to work at a daycare in {stateName}?",
        a: "Requirements vary by role and facility type. Assistant teacher roles at licensed centers typically need a Child Development Associate (CDA) credential — a one-year certificate. Lead teacher in a public pre-K classroom usually requires an associate or bachelor's. Family child-care homes have lower minimums but the higher-paying jobs all require the AAS in early childhood.",
      },
      {
        q: "Can I transfer this credit to a teaching bachelor's?",
        a: "Usually yes for the general-education portion (English, math, US history) and the foundational child-development courses. Methods-and-practicum credits often need to be re-taken at the four-year level because state teacher-certification programs require specific supervised hours at their own partner schools. Compare colleges' transfer agreements below.",
      },
      {
        q: "What's the typical salary for an early-childhood teacher in {stateName}?",
        a: "Preschool teachers in {stateName} earn roughly the state's living wage — lower than public-school K–12 teachers but higher than minimum-wage daycare assistant roles. Head Start lead teachers earn more than private-center teachers thanks to federal funding. Many graduates stack on the CDA, AAS, and eventually a B.A. to keep climbing the pay scale.",
      },
      {
        q: "How long does the ECE associate take?",
        a: "Two years full-time, including the supervised practicum semester. Many programs are offered fully part-time and online (except for the practicum hours), letting working assistants complete it in 3–4 years while continuing to work.",
      },
    ],
  },

  "criminal-justice": {
    intro: [
      "{stateName} community college criminal-justice programs feed directly into law enforcement, corrections, court, and victim-services careers across the state. The {totalSections} sections at {totalColleges} {systemName} colleges this term cover criminology, criminal law, evidence and procedure, corrections theory, and the field-applicable foundation police academies expect from recruits.",
      "The CC criminal-justice associate isn't a shortcut to becoming a police officer — most {stateName} departments still require academy graduation regardless of degree — but it counts strongly during the hiring process, qualifies you for higher entry pay grades at many agencies, and is the standard prep for federal law-enforcement, probation officer, and corrections-officer roles that increasingly prefer degree holders.",
    ],
    faq: [
      {
        q: "Do I need a criminal-justice degree to become a police officer in {stateName}?",
        a: "No — police academies in {stateName} accept candidates with just a high school diploma or GED plus background-check clearance. But a CJ associate's makes a difference in three ways: it boosts your competitive ranking in hiring, qualifies you for higher entry pay at most municipal agencies (typically a $1–3k starting-salary bump), and lets you sit for promotional exams sooner.",
      },
      {
        q: "What jobs does this degree qualify me for besides policing?",
        a: "Corrections officer (county jail, state prison), probation/parole officer, court clerk, victim advocate, security supervisor, juvenile-justice case manager, federal-agency entry roles (CBP, TSA, US Marshals support staff). Many graduates work corrections or court roles for a few years while preparing for police-academy admission.",
      },
      {
        q: "Can I transfer CJ credits to a four-year program?",
        a: "Yes — most {stateName} state universities have criminal-justice bachelor's programs with articulated transfer from the {systemName} associate. Some specialized degrees (forensic science, cybersecurity-focused CJ, pre-law CJ) require specific lower-division courses, so confirm with the target university's transfer office before locking your schedule.",
      },
      {
        q: "How long does the criminal-justice associate take?",
        a: "Two years full-time. Many {stateName} community colleges offer evening and online sections aimed at working students — current corrections officers, security personnel, and military veterans use those formats to complete the degree while staying in their current jobs.",
      },
    ],
  },

  "liberal-arts": {
    intro: [
      "The liberal-arts associate at {stateName} community colleges is the most common transfer degree in the {systemName} system. It's designed as a complete 2-year general-education foundation — English composition, history, math, lab science, social science, fine arts — that articulates to any four-year university in the state. Students complete two years at community-college tuition rates and arrive at the bachelor's program as juniors with sophomore standing in their declared major.",
      "This term's {totalSections} sections across {totalColleges} {systemName} colleges fill those general-education buckets. The right college often comes down to schedule (online availability, evening sections) and proximity rather than program differences — the curriculum is intentionally similar across institutions to keep the transfer guarantee working. Compare colleges below by section count and transfer agreements.",
    ],
    faq: [
      {
        q: "What is a liberal-arts degree good for?",
        a: "Almost exclusively transfer. The liberal-arts AA isn't a career-track degree on its own; it's the first two years of a bachelor's, packaged so you can complete it at much lower tuition before moving to a four-year school. The major you eventually declare at the four-year (English, history, sociology, psychology, business, etc.) determines your career path.",
      },
      {
        q: "Will all my liberal-arts credits transfer to a {stateName} four-year university?",
        a: "If you complete the full associate of arts at a {systemName} college, yes — under {stateName}'s statewide articulation agreement, the entire degree transfers as a block to any public four-year, giving you junior standing. Where students lose credits is by taking random courses outside the structured AA pathway. Talk to your transfer advisor early.",
      },
      {
        q: "Can I save money by doing my first two years at community college?",
        a: "Yes, often substantially. {stateName} community college tuition is typically less than half what a state university charges, and the credits transfer 1:1 if you stick to the structured AA. Two years of saved tuition often translates to $20–40k less debt at graduation.",
      },
      {
        q: "How long does the liberal-arts associate take?",
        a: "Two years full-time (60 credits). Many students complete it in three or more years on a part-time schedule — community colleges build their evening, weekend, and online sections around working students.",
      },
    ],
  },

  engineering: {
    intro: [
      "Two distinct engineering pathways run through {stateName} community colleges: the transfer-track pre-engineering associate that articulates to a bachelor's in mechanical, electrical, or civil engineering at a four-year school, and the engineering-technology associate (AAS) that prepares students directly for industrial-tech, manufacturing-engineering-tech, and CAD-drafter careers. The {totalSections} sections across {totalColleges} {systemName} institutions cover both — calculus and physics for the transfer track, applied automation and materials for the AAS.",
      "Engineering proper (the licensed P.E. profession) requires a bachelor's from an ABET-accredited program. CC's role is to provide the first two years at lower cost, especially the heavy calculus and physics sequence that many four-year programs treat as a weed-out. The engineering-technology track is a complete career credential on its own — graduates work as technicians, lab specialists, and field engineers without continuing to a bachelor's.",
    ],
    faq: [
      {
        q: "Can I become an engineer with just an associate degree?",
        a: "Not in the licensed-engineer sense — the P.E. (Professional Engineer) license requires a bachelor's from an ABET-accredited program. But you can absolutely work as an engineering technologist, engineering technician, or specialized field role (CAD drafter, surveying technician, manufacturing technician) with the AAS in engineering technology.",
      },
      {
        q: "Does the pre-engineering associate transfer cleanly to a four-year program?",
        a: "Largely yes if you follow the structured pre-engineering pathway — Calculus I/II/III, Differential Equations, Physics with Calculus, Chemistry I, and intro engineering. Programs vary in which discipline they're best aligned to (mechanical vs electrical vs civil); confirm with the target four-year school before enrolling. Engineering majors are tightly sequenced and a missing prerequisite can cost a semester.",
      },
      {
        q: "What's the difference between engineering and engineering technology?",
        a: "Engineering programs focus on theory and design — you'll work as a P.E. designing new systems. Engineering technology programs focus on applying existing designs — you'll work as a technician building, testing, or maintaining systems engineers have specified. Both are good careers; ET grads earn solid wages and don't need a bachelor's.",
      },
      {
        q: "Is the math required for engineering at a community college?",
        a: "Yes, and that's one of the strongest reasons to start at CC. The Calculus I → II → III → Differential Equations sequence is the same content at CC and four-year, but CC class sizes are smaller and tuition is much lower. Many engineering students who struggled with high-school math intentionally take the calculus sequence at CC before transferring.",
      },
    ],
  },

  biology: {
    intro: [
      "Biology coursework at {stateName} community colleges sits at the foot of the pre-health pipeline: pre-nursing, pre-med, pre-pharmacy, pre-dental, and pre-PT students all complete their lower-division biology — anatomy, physiology, microbiology, general biology — at community college tuition rates before transferring or applying to professional programs. The {totalSections} sections across {totalColleges} {systemName} institutions this term include the lab-heavy sequences that admissions committees specifically look for.",
      "A standalone biology associate isn't directly career-track — most biology careers require a bachelor's or graduate degree — but the credits transfer cleanly to four-year biology programs in {stateName}, and the lab experience builds the foundation health-profession schools expect. Compare colleges below for online vs in-person section availability; many programs require live lab attendance even when lecture is online.",
    ],
    faq: [
      {
        q: "Can I take pre-med biology courses at a community college?",
        a: "Yes, and many med-school applicants do — at lower tuition and often with smaller class sizes than at a four-year. The caveat: med schools sometimes prefer to see at least the upper-division biology (cell, genetics, biochemistry) taken at a four-year institution. Talk to a pre-health advisor early; the strategy varies by which med schools you're targeting.",
      },
      {
        q: "Do biology lab credits transfer to a bachelor's program?",
        a: "Usually yes for general bio, anatomy, physiology, and microbiology — the standard pre-health four. Specialized labs (organic chemistry lab, biochemistry lab, upper-division cell biology lab) often need to be retaken at the four-year because the lab equipment and protocols differ. Confirm with the target program before enrolling.",
      },
      {
        q: "What can I do with just a biology associate degree?",
        a: "Limited but real: biological technician roles (lab tech at research institutions, pharma quality-control, environmental monitoring), some health-care support roles (medical assistant if combined with appropriate certifications), and entry-level government inspection roles. The strongest direct-career CC pathways for the bio-curious are nursing, dental hygiene, and medical lab technology — career-track programs rather than the transfer-track biology associate.",
      },
      {
        q: "How long is the biology associate?",
        a: "Two years full-time. Pre-health students often take it in 2.5–3 years to fit in the additional chemistry and physics courses that med, PT, dental, and pharmacy schools require in addition to the standard biology sequence.",
      },
    ],
  },

  psychology: {
    intro: [
      "Intro and developmental psychology are among the highest-enrollment sections at {stateName} community colleges — partly because most college students take at least one psych course as a general-education requirement, and partly because the field is a popular transfer-track major. {totalSections} sections across {totalColleges} {systemName} colleges this term cover general psychology, abnormal psychology, developmental psych, and statistics for psychology.",
      "A psychology associate is almost entirely transfer-prep. Direct career roles in psychology (clinical, counseling, school) require a graduate degree, but the CC associate completes the first two years of a four-year psychology bachelor's at lower tuition. Adjacent career paths — social services case manager, behavioral technician, mental-health technician — open up with just the associate plus relevant certifications.",
    ],
    faq: [
      {
        q: "Can I become a therapist or psychologist with a CC degree?",
        a: "No. Clinical and counseling psychology require at least a master's degree (Licensed Professional Counselor) and often a doctorate (Ph.D. or Psy.D.) plus state licensure. The CC associate is the first two years of the path; expect 6+ more years of education after the bachelor's to practice clinically.",
      },
      {
        q: "What jobs are available with just an associate in psychology?",
        a: "Direct-service roles that benefit from psych foundations but don't require licensure: behavior technician (especially in autism / ABA settings), mental-health technician at residential facilities, social-services case manager, school paraprofessional, and intake or admissions specialist at human-services agencies. Pay is modest but the work is meaningful and the field has steady openings.",
      },
      {
        q: "Does psychology credit transfer to a four-year program?",
        a: "Yes — intro psych, developmental, abnormal, social, and psychology statistics all transfer cleanly to {stateName} state universities under the standard articulation agreement. The structured associate-of-science-in-psychology pathway is the safest route to ensure every credit applies toward the major.",
      },
      {
        q: "Is community college a good place to start psychology?",
        a: "Often yes — the intro psychology sequences are the same content at CC and four-year, taught at substantially lower tuition with often smaller class sizes. Students serious about clinical careers should plan for the bachelor's and graduate work to follow; students considering related applied fields (social work, counseling, education) can use the associate as a flexible foundation.",
      },
    ],
  },

  welding: {
    intro: [
      "Welding programs at {stateName} community colleges are among the most direct paths from enrollment to a full-time skilled-trade job in the state. Most {systemName} welding programs are one-year diploma or two-year AAS sequences aligned to AWS (American Welding Society) certifications — SMAW (stick), GMAW (MIG), GTAW (TIG), and FCAW (flux-cored). The {totalSections} sections at {totalColleges} institutions this term combine bench-work hours with metallurgy theory and blueprint reading.",
      "Welders graduating with AWS certifications step into manufacturing, pipeline, structural-steel, and shipyard jobs without needing further education. Pay is competitive (often above other CC-trade tracks), demand outpaces supply in most {stateName} metro areas, and the certification stacking — adding pipe, aluminum, and underwater certifications over time — keeps the career growing.",
    ],
    faq: [
      {
        q: "How long does a welding program take at a community college?",
        a: "One-year diploma programs cover the AWS Certified Welder fundamentals (SMAW + GMAW for structural steel). Two-year AAS programs add advanced processes (TIG, pipe welding), blueprint reading, materials science, and supervisory coursework. Many students start with the diploma, get hired, then return for the AAS while working.",
      },
      {
        q: "What welding certifications can I earn?",
        a: "AWS Certified Welder is the baseline credential — most {stateName} programs prepare graduates to test for it on multiple processes (SMAW, GMAW, GTAW, FCAW) in multiple positions (flat, horizontal, vertical, overhead). Specialty certs (6G pipe, structural code D1.1, pressure-vessel code D1.5) come from employer-sponsored testing after hire and pay significantly more.",
      },
      {
        q: "What's the demand for welders in {stateName}?",
        a: "Strong. Industrial manufacturing, pipeline maintenance, shipyard work, and infrastructure construction all need welders, and the workforce is aging faster than it's being replaced. BLS projects 2% growth nationally through 2032, but starting wages have risen 15-20% in the last five years as employers compete for trained welders.",
      },
      {
        q: "Do I need a four-year degree to advance in welding?",
        a: "No. Career progression goes: certified welder → senior welder → welding inspector (CWI certification, employer-paid) → welding supervisor → welding engineer. The CWI is the credential that opens supervisory and inspection roles at $25–35/hr+; the welding-engineer path requires more formal education but is the exception, not the norm. Most welders advance via certification stacking, not college credit.",
      },
    ],
  },

  "automotive-technology": {
    intro: [
      "Auto-tech programs at {stateName} community colleges prepare students for ASE-certified service technician careers at dealerships, independent repair shops, fleet operations, and specialty performance/heavy-equipment facilities. The {totalSections} sections at {totalColleges} {systemName} colleges this term combine shop hours on real vehicles with theory in engines, transmissions, brakes, electronics, HVAC, and (increasingly) electric and hybrid drivetrains.",
      "Most {stateName} programs are NATEF-accredited and aligned to ASE testing — graduates can sit for individual ASE exams (A1 engine repair, A4 suspension/steering, etc.) and stack credentials over their career. The diploma or AAS gets students into the shop; the ASE certifications and dealer-specific training (Ford ASSET, GM ASEP, Honda PACT) are what determine long-term pay.",
    ],
    faq: [
      {
        q: "Will I need to buy my own tools?",
        a: "Eventually yes. Most {stateName} programs supply the shop tools you'll use during training, but ASE-certified service technicians at dealerships and independents are expected to bring their own. Tool collections build over a career; budget $3-8k in the first year of full-time employment, much more over time. Some shops offer tool-purchase assistance for new hires.",
      },
      {
        q: "What's the pay range for an auto tech?",
        a: "Starting techs (apprentices, lube-rack roles) earn $15-20/hr at most {stateName} shops. Master-certified techs with multiple ASE credentials at busy dealerships earn $25-45/hr, often on a flat-rate (book-time) system that rewards faster, more efficient work. Diesel and specialty techs (BMW, Mercedes, performance shops) earn the upper end. Independent-shop ownership is the long-tail career path.",
      },
      {
        q: "Are EV-specific training and certifications part of the program?",
        a: "Increasingly yes. Most {stateName} community college auto-tech programs have added high-voltage safety training and intro EV-drivetrain content in the last few years; some offer dedicated EV-tech credentials. The dealer-specific programs (Ford ASSET-EV, GM ASEP-EV) cover brand-specific procedures and are the strongest credential for EV-focused careers.",
      },
      {
        q: "Do I need an associate degree or just the diploma?",
        a: "For getting hired as a tech, the one-year diploma plus ASE certs is enough at most {stateName} shops. The AAS adds business courses, management, and writing — useful if you eventually want to run your own shop or move into service-advisor / shop-foreman roles. Many techs come back for the AAS after a few years in the field.",
      },
    ],
  },

  history: {
    intro: [
      "History coursework at {stateName} community colleges serves two student groups: liberal-arts transfer students completing their gen-ed history requirements, and history majors finishing their first two years before transferring to a four-year history program. The {totalSections} sections across {totalColleges} {systemName} colleges this term cover US history surveys, world civilizations, and topical electives.",
      "Like other transfer-oriented humanities programs, the value isn't in the associate as a terminal credential — it's in the credit transfer + smaller class sizes + lower tuition for the same content. Students serious about history careers (teaching, archival, academic) continue to bachelor's and often graduate programs; the CC associate is step one of a longer path.",
    ],
    faq: [
      {
        q: "Is a history major worth pursuing if I'm starting at community college?",
        a: "It can be, if you have a clear post-bachelor's plan. History majors land in teaching, law, journalism, publishing, museum work, and government — the major teaches research and writing skills employers value, but the credential alone doesn't open doors. The CC associate is a cost-effective way to complete the first two years; the bachelor's, and often a graduate or professional degree, do the actual career-positioning.",
      },
      {
        q: "Do US history and world history requirements transfer between schools?",
        a: "Yes — these are general-education staples that articulate cleanly across {stateName} public colleges. Specialized history electives (regional, topical) may transfer as upper-division-history-elective credit rather than counting toward a specific major requirement; the structured AA-in-history pathway minimizes this risk.",
      },
      {
        q: "What jobs are available with a history associate alone?",
        a: "Few that specifically use the history content — entry-level office work, retail management, customer service. The skills built (research, writing, analysis) transfer to many entry roles, but the credential signaling is weaker than career-track associates. Most history students continue to a bachelor's; the associate is step one.",
      },
      {
        q: "Can I become a history teacher with just an associate degree?",
        a: "No. K-12 social studies teaching requires a bachelor's plus a teaching certification in {stateName}. Postsecondary history teaching at community colleges and four-year programs requires at least a master's, usually a Ph.D.",
      },
    ],
  },

  mathematics: {
    intro: [
      "Math is among the most consequential coursework students take at {stateName} community colleges — both because it gates progress into many degrees (nursing, engineering, business) and because it's the most-failed subject for community college students nationally. {totalColleges} {systemName} institutions offer {totalSections} sections this term, from developmental algebra through Calculus III, statistics, and discrete math.",
      "The math associate as a standalone credential is rare — most students taking lots of math at CC are using it as pre-engineering, pre-CS, pre-actuarial, or pre-finance preparation. Compare colleges below by section availability (especially calculus, which not every CC offers locally) and online vs in-person options.",
    ],
    faq: [
      {
        q: "Which math classes count for a four-year college?",
        a: "College Algebra, Trigonometry, Precalculus, Statistics, Calculus I/II/III, and Differential Equations transfer cleanly to {stateName} four-year programs. Developmental math (pre-algebra, basic algebra) doesn't transfer but is often required to enter college-level math. Take the placement test before enrolling; many {stateName} colleges now offer accelerated pathways that skip much of the developmental sequence.",
      },
      {
        q: "Can I take Calculus at a community college and transfer it cleanly?",
        a: "Yes — Calculus I, II, and III at any {systemName} college articulate to the standard calculus sequence at {stateName} four-year programs. This is one of the strongest CC value propositions: same content as the four-year, smaller class sizes, much lower tuition. Many engineering and physics majors intentionally take calculus at CC before transferring.",
      },
      {
        q: "What can I do with a math associate degree?",
        a: "Standalone: not much directly — entry roles for math-heavy careers (actuarial, statistician, data analyst) require a bachelor's. The associate is most valuable as the lower-division foundation for transfer to math, engineering, computer science, economics, or finance bachelor's programs.",
      },
      {
        q: "How do I know which math course to start with?",
        a: "{stateName} community colleges use placement tests (Accuplacer, ALEKS, multiple-measures placement) or your high-school transcript GPA + most-recent math grade to place you. Most colleges allow you to challenge a higher placement. Talk to a math advisor before your first semester — placing too low costs time and tuition; placing too high causes a failed course.",
      },
    ],
  },

  english: {
    intro: [
      "English composition is required at virtually every four-year college in {stateName} for graduation, and the two-semester intro composition sequence (English I and II) is among the most-enrolled courses at {systemName} community colleges. The {totalSections} sections across {totalColleges} institutions this term cover composition, intro literature, technical writing, and creative writing.",
      "The English associate is a transfer pathway — completing the first two years of an English bachelor's at community-college tuition. Direct career roles in English (technical writer, copy editor, content marketer) typically need a bachelor's and a strong portfolio. Compare colleges below for online section availability; English I and II are among the most-online-available courses across {systemName}.",
    ],
    faq: [
      {
        q: "Will my English composition credits transfer?",
        a: "Yes — English I and English II from any {systemName} college transfer 1:1 to every {stateName} public four-year. Most also transfer to out-of-state public and private institutions, though the specific course-equivalence depends on each receiving school's catalog. English composition is among the most reliably transferable courses you can take.",
      },
      {
        q: "Can I major in English at a community college?",
        a: "You can complete the associate of arts with an English focus — the first two years of an English bachelor's — but the upper-division (literature theory, advanced writing seminars, capstone) only happens at a four-year. CC English faculty often teach intro literature and creative writing well, especially small workshop-style courses; serious English majors get strong preparation at the CC level.",
      },
      {
        q: "What jobs does an English degree qualify me for?",
        a: "With just the associate: limited direct roles — entry copywriting at small companies, administrative work, content moderation. With the bachelor's added: technical writer, content marketing, editor, communications coordinator, teacher (with certification), journalist, publishing assistant. The strongest English-major careers combine the writing skills with a domain specialty.",
      },
      {
        q: "Is the writing instruction at community college as good as at a four-year?",
        a: "Often yes, sometimes better. Community-college composition classes are typically smaller (20-25 students) than the large-lecture composition courses at flagship state universities, and CC English instructors are usually full-time teaching faculty (not graduate students). The instruction quality is high; the credential signaling is what differs.",
      },
    ],
  },

  art: {
    intro: [
      "{stateName} community college art programs span studio art (drawing, painting, sculpture, ceramics) and applied design (graphic design, digital media, illustration). The {totalSections} sections across {totalColleges} {systemName} colleges this term include intro studio courses, art history, design fundamentals, and software-specific training (Adobe Creative Suite, Procreate, Blender for 3D).",
      "Two distinct outcomes: the studio-art associate is largely transfer-prep for BFA programs at four-year art schools; the graphic-design AAS is a direct-to-career credential preparing students for entry design roles, agency junior positions, and in-house marketing teams. Compare colleges below — programs with strong portfolio-development emphasis place graduates better than those focused purely on technique.",
    ],
    faq: [
      {
        q: "Can I be a graphic designer with just a community-college degree?",
        a: "Yes — the AAS in graphic design is a complete entry-level credential, and most {stateName} programs are designed to build a portfolio strong enough for junior designer roles. Hiring is heavily portfolio-driven; the degree gets you in the door but your portfolio determines whether you get the role. Software fluency (Illustrator, Photoshop, InDesign) is table stakes.",
      },
      {
        q: "Will my art credits transfer to a BFA program?",
        a: "Studio courses (drawing, painting, sculpture) typically transfer as elective credit toward a BFA but may not fulfill specific BFA major-requirement slots — BFA programs usually want their own foundation sequence. Art history and gen-ed courses transfer cleanly. The associate of fine arts (AFA) is the strongest transfer-prep pathway if you know you'll continue to a BFA; check articulation agreements with target schools.",
      },
      {
        q: "What's the difference between studio art and graphic design programs?",
        a: "Studio art is fine-art-oriented (creating original work, often for galleries or commission); graphic design is commercial-art-oriented (creating work to client briefs for marketing, branding, packaging, web). The career economics are very different — graphic designers have many more entry roles available; studio artists typically need to build a separate career while developing their practice.",
      },
      {
        q: "Do I need to be 'good at art' to start?",
        a: "Less than you'd think for graphic design — the program teaches design principles and software from the foundation up. Studio art programs assume more foundational drawing skill but most {stateName} CCs offer beginner-level studio courses; the question is whether you have time and motivation to put in the hours of practice that any visual-art career requires.",
      },
    ],
  },
};
