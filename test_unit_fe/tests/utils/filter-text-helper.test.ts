import { describe, expect, it } from "vitest"

import { filterStateToText } from "@/lib/utils/filter-text-helper"

describe("filter-text-helper", () => {
  it("renders empty and populated filter summaries", () => {
    expect(filterStateToText(null as any, [])).toBe("")
    expect(filterStateToText({ groups: [], groupLogic: "AND" } as any, [])).toBe("")
    expect(
      filterStateToText(
        {
          groupLogic: "AND",
          groups: [{ logic: "AND", conditions: [{ field: "", operator: "equals", value: "x" }] }],
        } as any,
        []
      )
    ).toBe("")

    const text = filterStateToText(
      {
        groupLogic: "OR",
        groups: [
          {
            logic: "AND",
            conditions: [
              { field: "status", operator: "equals", value: "active" },
              { field: "score", operator: "between", value: 1, valueTo: 5 },
              { field: "tags", operator: "in", value: ["a", "b"] },
              { field: "tags", operator: "not_in", value: "solo" },
              { field: "deleted", operator: "is_null" },
              { field: "alive", operator: "is_not_null" },
              { field: "flag", operator: "equals", value: true },
              { field: "when", operator: "equals", value: "2024-01-15" },
            ],
          },
          {
            logic: "OR",
            conditions: [{ field: "name", operator: "contains", value: "Ada" }],
          },
        ],
      } as any,
      [
        {
          field: "status",
          label: "Status",
          type: "select",
          options: [{ value: "active", label: "Active" }],
        },
        { field: "score", label: "Score", type: "number" },
        { field: "tags", label: "Tags", type: "text" },
        { field: "deleted", label: "Deleted", type: "boolean" },
        { field: "alive", label: "Alive", type: "boolean" },
        { field: "flag", label: "Flag", type: "boolean" },
        { field: "when", label: "When", type: "date" },
        { field: "name", label: "Name", type: "text" },
      ] as any
    )
    expect(text).toContain("Status")
    expect(text).toContain("Active")
    expect(text).toContain("Score")
    expect(text).toContain(" OR ")
    expect(text).toContain("Yes")
  })
})
