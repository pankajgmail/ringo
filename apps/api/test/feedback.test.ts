import { describe, expect, it } from "vitest";
import { FeedbackSchema, IN_CALL_TYPES } from "@ringo/shared";

describe("feedback", () => {
  it("takes 1 to 5 whole stars with an optional comment", () => {
    expect(FeedbackSchema.parse({ rating: 5, comment: "  great  " })).toEqual({ rating: 5, comment: "great" });
    expect(FeedbackSchema.parse({ rating: 1 })).toEqual({ rating: 1 });
    for (const rating of [0, 6, 3.5]) expect(FeedbackSchema.safeParse({ rating }).success).toBe(false);
    expect(FeedbackSchema.safeParse({ rating: 4, comment: "x".repeat(2001) }).success).toBe(false);
  });

  it("keeps sales calls separate from spam", () => {
    expect(IN_CALL_TYPES).toContain("sales");
    expect(IN_CALL_TYPES).toContain("spam");
  });
});
