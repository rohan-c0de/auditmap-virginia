import { describe, expect, it } from "vitest";
import {
  parseTime,
  parseTimeToMinutes,
  daysToBitmask,
  expandDays,
  isValidTime,
  timeToSlot,
  formatHour,
  DAY_BITS,
  START_HOUR,
} from "../time-utils";

describe("parseTime", () => {
  it("parses standard AM/PM times", () => {
    expect(parseTime("9:30 AM")).toBe(9.5);
    expect(parseTime("11:00 AM")).toBe(11);
    expect(parseTime("1:00 PM")).toBe(13);
    expect(parseTime("5:45 PM")).toBe(17.75);
  });

  it("handles noon and midnight correctly", () => {
    expect(parseTime("12:00 PM")).toBe(12);
    expect(parseTime("12:30 AM")).toBe(0.5);
  });

  it("accepts lowercase and missing space", () => {
    expect(parseTime("9:00am")).toBe(9);
    expect(parseTime("1:00PM")).toBe(13);
  });

  it("returns null for TBA, empty, and 0:00 AM", () => {
    expect(parseTime("TBA")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("0:00 AM")).toBeNull();
  });

  it("returns null for malformed strings", () => {
    expect(parseTime("9 AM")).toBeNull();
    expect(parseTime("garbage")).toBeNull();
    expect(parseTime("9:30")).toBeNull();
  });
});

describe("parseTimeToMinutes", () => {
  it("converts to minutes since midnight", () => {
    expect(parseTimeToMinutes("12:00 AM")).toBe(0);
    expect(parseTimeToMinutes("9:30 AM")).toBe(570);
    expect(parseTimeToMinutes("12:00 PM")).toBe(720);
    expect(parseTimeToMinutes("11:59 PM")).toBe(1439);
  });

  it("returns -1 for invalid times", () => {
    expect(parseTimeToMinutes("TBA")).toBe(-1);
    expect(parseTimeToMinutes("")).toBe(-1);
    expect(parseTimeToMinutes("garbage")).toBe(-1);
  });
});

describe("daysToBitmask", () => {
  it("encodes single-day strings", () => {
    expect(daysToBitmask("M")).toBe(DAY_BITS.M);
    expect(daysToBitmask("Tu")).toBe(DAY_BITS.Tu);
    expect(daysToBitmask("Sa")).toBe(DAY_BITS.Sa);
  });

  it("encodes multi-day spaced strings", () => {
    expect(daysToBitmask("M W F")).toBe(DAY_BITS.M | DAY_BITS.W | DAY_BITS.F);
    expect(daysToBitmask("Tu Th")).toBe(DAY_BITS.Tu | DAY_BITS.Th);
  });

  it("encodes compact concatenated strings", () => {
    expect(daysToBitmask("MWF")).toBe(DAY_BITS.M | DAY_BITS.W | DAY_BITS.F);
    expect(daysToBitmask("TuTh")).toBe(DAY_BITS.Tu | DAY_BITS.Th);
    expect(daysToBitmask("MTuWThF")).toBe(
      DAY_BITS.M | DAY_BITS.Tu | DAY_BITS.W | DAY_BITS.Th | DAY_BITS.F
    );
  });

  it("returns 0 for empty input", () => {
    expect(daysToBitmask("")).toBe(0);
  });
});

describe("expandDays", () => {
  it("leaves already-spaced strings alone", () => {
    expect(expandDays("M W F")).toBe("M W F");
  });

  it("splits compact strings on two-letter codes first", () => {
    expect(expandDays("TuTh")).toBe("Tu Th");
    expect(expandDays("MTuWThF")).toBe("M Tu W Th F");
    expect(expandDays("MWF")).toBe("M W F");
  });
});

describe("isValidTime", () => {
  it.each([
    ["9:00 AM", true],
    ["", false],
    ["TBA", false],
    ["0:00 AM", false],
    ["0:00 PM", false],
  ])("isValidTime(%j) === %s", (input, expected) => {
    expect(isValidTime(input)).toBe(expected);
  });
});

describe("timeToSlot", () => {
  it("maps decimal hours to half-hour slot index off START_HOUR", () => {
    expect(timeToSlot(START_HOUR)).toBe(0);
    expect(timeToSlot(START_HOUR + 0.5)).toBe(1);
    expect(timeToSlot(START_HOUR + 1)).toBe(2);
  });
});

describe("formatHour", () => {
  it("formats 0 and 12 as 12", () => {
    expect(formatHour(0)).toBe("12");
    expect(formatHour(12)).toBe("12");
  });

  it("formats afternoon hours as 12-hour", () => {
    expect(formatHour(13)).toBe("1");
    expect(formatHour(17)).toBe("5");
  });

  it("formats morning hours as-is", () => {
    expect(formatHour(8)).toBe("8");
    expect(formatHour(11)).toBe("11");
  });
});
