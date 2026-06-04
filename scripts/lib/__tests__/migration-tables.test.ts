import { describe, expect, it } from "vitest";
import { parseTableOps, expectedTables } from "../migration-tables";

describe("parseTableOps", () => {
  it("extracts CREATE TABLE names (plain, IF NOT EXISTS, public., quoted)", () => {
    const sql = `
      CREATE TABLE profiles ( id uuid );
      CREATE TABLE IF NOT EXISTS saved_plans ( id uuid );
      CREATE TABLE public.seat_snapshots ( state text );
      CREATE TABLE "plan_seat_notifications" ( id uuid );
    `;
    expect(parseTableOps(sql).created.sort()).toEqual([
      "plan_seat_notifications",
      "profiles",
      "saved_plans",
      "seat_snapshots",
    ]);
  });

  it("ignores CREATE TABLE inside line and block comments", () => {
    const sql = `
      -- CREATE TABLE commented_out_line ( x int );
      /* CREATE TABLE commented_out_block ( x int ); */
      CREATE TABLE real_table ( x int );
    `;
    expect(parseTableOps(sql).created).toEqual(["real_table"]);
  });

  it("captures DROP TABLE (incl. IF EXISTS)", () => {
    expect(parseTableOps("DROP TABLE IF EXISTS old_thing;").dropped).toEqual(["old_thing"]);
  });

  it("does not match CREATE INDEX / CREATE POLICY / ALTER TABLE", () => {
    const sql = `
      CREATE INDEX idx ON foo(x);
      CREATE POLICY p ON foo FOR SELECT USING (true);
      ALTER TABLE foo ADD COLUMN y int;
    `;
    expect(parseTableOps(sql).created).toEqual([]);
  });
});

describe("expectedTables", () => {
  it("computes the net set across migrations, honoring later drops", () => {
    const m1 = "CREATE TABLE a (x int); CREATE TABLE b (x int);";
    const m2 = "DROP TABLE a; CREATE TABLE c (x int);";
    expect(expectedTables([m1, m2])).toEqual(["b", "c"]);
  });

  it("dedupes a table created with IF NOT EXISTS across two migrations", () => {
    const m1 = "CREATE TABLE t (x int);";
    const m2 = "CREATE TABLE IF NOT EXISTS t (x int);";
    expect(expectedTables([m1, m2])).toEqual(["t"]);
  });
});
