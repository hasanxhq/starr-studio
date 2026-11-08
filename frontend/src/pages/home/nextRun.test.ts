import { describe, expect, it } from "vitest";

import { phraseNextRun } from "./nextRun";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();
const now = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).getTime();

describe("phraseNextRun", () => {
  it("calls today's daytime runs today and evening or small-hours runs tonight", () => {
    expect(phraseNextRun(at(8, 15), now(8, 9))).toBe("today 15:00");
    expect(phraseNextRun(at(8, 22), now(8, 9))).toBe("tonight 22:00");
    expect(phraseNextRun(at(9, 3), now(8, 20))).toBe("tonight 03:00");
    expect(phraseNextRun(at(8, 3), now(8, 1))).toBe("tonight 03:00");
  });

  it("says tomorrow for tomorrow's daytime, then the weekday", () => {
    expect(phraseNextRun(at(9, 9), now(8, 20))).toBe("tomorrow 09:00");
    expect(phraseNextRun(at(11, 9), now(8, 20))).toMatch(/^\S+ 09:00$/);
    expect(phraseNextRun(at(11, 9), now(8, 20))).not.toMatch(/^(today|tonight|tomorrow)/);
  });
});
