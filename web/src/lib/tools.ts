import {
  STATE_NAMES,
  listDataflows,
  queryDataset,
  queryErp,
  queryErpAllStates,
} from "./abs";

const REGION_CODES = Object.keys(STATE_NAMES);
const SEX_VALUES = ["persons", "male", "female"] as const;

// JSON-shaped tool definitions (no Anthropic SDK in browser). The Messages API
// accepts a plain array of {name, description, input_schema} objects.
export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const tools: ToolDef[] = [
  {
    name: "get_population",
    description:
      "Get the estimated resident population for Australia or a single state/territory. Returns the latest quarter by default, or a specific quarter if `period` is given. Source: Australian Bureau of Statistics, ERP_Q (Estimated Resident Population, Quarterly).",
    input_schema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          enum: REGION_CODES,
          description:
            "Region code. AUS = whole of Australia. State/territory codes: NSW, VIC, QLD, SA, WA, TAS, NT, ACT.",
        },
        period: {
          type: "string",
          description:
            "Optional ISO quarter like '2024-Q2'. Omit for the latest available quarter.",
        },
        sex: {
          type: "string",
          enum: [...SEX_VALUES],
          description:
            "Defaults to 'persons' (total). Use 'male' or 'female' for sex-specific counts.",
        },
      },
      required: ["region"],
    },
  },
  {
    name: "get_population_time_series",
    description:
      "Get a quarterly time series of estimated resident population for a region. Use this for trends, growth, or charts over a range of years.",
    input_schema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          enum: REGION_CODES,
          description:
            "Region code (AUS, NSW, VIC, QLD, SA, WA, TAS, NT, ACT).",
        },
        start_period: {
          type: "string",
          description:
            "Start quarter (e.g. '2010-Q1') or year (e.g. '2010'). Optional.",
        },
        end_period: {
          type: "string",
          description: "End quarter or year. Optional.",
        },
        sex: { type: "string", enum: [...SEX_VALUES] },
      },
      required: ["region"],
    },
  },
  {
    name: "compare_states",
    description:
      "Get the latest (or specified period) estimated resident population for ALL Australian states and territories at once. Use this for rankings, comparisons, or 'which state has the most/least people' questions.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description:
            "Optional quarter like '2024-Q2'. Omit for the latest available.",
        },
        sex: { type: "string", enum: [...SEX_VALUES] },
      },
      required: [],
    },
  },
  {
    name: "list_abs_dataflows",
    description:
      "Search the catalog of ABS datasets (dataflows) by keyword. Use this to discover datasets beyond population — e.g. births, deaths, migration, labour force, housing. Returns dataflow IDs you can then pass to `query_abs_dataset`.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description:
            "Keyword to filter dataflows by ID, name, or description (e.g. 'birth', 'migration', 'labour').",
        },
      },
      required: [],
    },
  },
  {
    name: "query_abs_dataset",
    description:
      "Generic escape hatch: query ANY ABS dataflow with an SDMX key. Use this when the specific tools above don't fit. The SDMX key is a dot-separated string of dimension codes — use empty strings (consecutive dots) for 'all values' of a dimension. Example: dataflow='ERP_Q', key='1.3.TT.AUS.AUS.Q' for total Australian population. If you don't know a dataflow's key shape, call `list_abs_dataflows` first.",
    input_schema: {
      type: "object",
      properties: {
        dataflow: {
          type: "string",
          description:
            "ABS dataflow ID (e.g. 'ERP_Q', 'BIRTHS_AGE_STATE').",
        },
        key: {
          type: "string",
          description:
            "SDMX key — dot-separated dimension values. Use '+' for OR within a dimension, leave a segment empty for ALL values.",
        },
        start_period: { type: "string" },
        end_period: { type: "string" },
      },
      required: ["dataflow", "key"],
    },
  },
];

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_population": {
        const region = String(input.region ?? "AUS");
        const sex = String(input.sex ?? "persons");
        const period = input.period ? String(input.period) : undefined;
        const result = await queryErp({
          region,
          sex,
          startPeriod: period,
          endPeriod: period,
        });
        const latest = pickLatest(result.observations);
        return {
          ok: true,
          data: {
            region,
            region_name: STATE_NAMES[region] ?? region,
            sex,
            latest,
            observation_count: result.observationCount,
            source_url: result.sourceUrl,
            note:
              "Estimated Resident Population (ERP) from ABS. Units = persons.",
          },
        };
      }
      case "get_population_time_series": {
        const region = String(input.region ?? "AUS");
        const sex = String(input.sex ?? "persons");
        const result = await queryErp({
          region,
          sex,
          startPeriod: input.start_period ? String(input.start_period) : undefined,
          endPeriod: input.end_period ? String(input.end_period) : undefined,
        });
        return {
          ok: true,
          data: {
            region,
            region_name: STATE_NAMES[region] ?? region,
            sex,
            observations: result.observations.map((o) => ({
              period: o.period,
              value: o.value,
            })),
            observation_count: result.observationCount,
            truncated: result.truncated,
            source_url: result.sourceUrl,
          },
        };
      }
      case "compare_states": {
        const sex = String(input.sex ?? "persons");
        const period = input.period ? String(input.period) : undefined;
        const result = await queryErpAllStates({
          sex,
          startPeriod: period,
          endPeriod: period,
        });
        const byRegion = new Map<
          string,
          { period: string; value: number | null }
        >();
        for (const obs of result.observations) {
          const r = obs.dimensions.REGION ?? "?";
          const existing = byRegion.get(r);
          if (!existing || obs.period > existing.period) {
            byRegion.set(r, { period: obs.period, value: obs.value });
          }
        }
        const rows = Array.from(byRegion.entries()).map(([region_name, v]) => ({
          region_name,
          period: v.period,
          value: v.value,
        }));
        rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        return {
          ok: true,
          data: {
            sex,
            rows,
            source_url: result.sourceUrl,
            note:
              "Estimated Resident Population by state/territory. Rows sorted descending by population.",
          },
        };
      }
      case "list_abs_dataflows": {
        const search = input.search ? String(input.search) : undefined;
        const flows = await listDataflows(search);
        return {
          ok: true,
          data: {
            count: flows.length,
            dataflows: flows.map((f) => ({
              id: f.id,
              name: f.name,
              description: f.description,
            })),
          },
        };
      }
      case "query_abs_dataset": {
        const result = await queryDataset({
          dataflow: String(input.dataflow),
          key: String(input.key),
          startPeriod: input.start_period
            ? String(input.start_period)
            : undefined,
          endPeriod: input.end_period ? String(input.end_period) : undefined,
        });
        return {
          ok: true,
          data: {
            dataflow: result.dataflow,
            observations: result.observations,
            observation_count: result.observationCount,
            truncated: result.truncated,
            source_url: result.sourceUrl,
          },
        };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function pickLatest(
  observations: Array<{ period: string; value: number | null }>,
) {
  if (observations.length === 0) return null;
  return observations.reduce((latest, obs) =>
    obs.period > latest.period ? obs : latest,
  );
}
