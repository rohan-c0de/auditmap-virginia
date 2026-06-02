import { describe, expect, it } from "vitest";
import { inferDeliveryMode } from "../infer-delivery-mode";

describe("inferDeliveryMode", () => {
  it("online when location names online/remote delivery", () => {
    expect(inferDeliveryMode({ location: "ONLINE" })).toBe("online");
    expect(inferDeliveryMode({ location: "Mesa Remote" })).toBe("online");
    expect(inferDeliveryMode({ location: "PART-ONL" })).toBe("online");
    expect(inferDeliveryMode({ location: "Online Async" })).toBe("online");
  });

  it("in-person when there is a named physical room (the san-diego case)", () => {
    expect(inferDeliveryMode({ location: "Mesa - Classroom" })).toBe("in-person");
    expect(inferDeliveryMode({ location: "M 112", days: "", start_time: "" })).toBe("in-person");
  });

  it("in-person when scheduled but no room listed (room TBA)", () => {
    expect(inferDeliveryMode({ location: "", days: "M T W Th F", start_time: "5:50 pm" })).toBe("in-person");
    expect(inferDeliveryMode({ days: "M W" })).toBe("in-person");
  });

  it("online (async) when nothing is scheduled and no location", () => {
    expect(inferDeliveryMode({ location: "", days: "", start_time: "" })).toBe("online");
    expect(inferDeliveryMode({})).toBe("online");
    expect(inferDeliveryMode({ location: null, days: null, start_time: null })).toBe("online");
  });

  it("never returns 'unknown'", () => {
    const inputs = [
      { location: "ONLINE" },
      { location: "Room 5" },
      { days: "M" },
      {},
    ];
    for (const i of inputs) {
      expect(["in-person", "online", "hybrid", "zoom"]).toContain(inferDeliveryMode(i));
    }
  });
});
