// Australian Bureau of Statistics Data API — SDMX-JSON client.
//
// All data is fetched directly from the browser; ABS publishes ERP_Q and most
// other dataflows publicly with CORS enabled. The flattener turns SDMX-JSON's
// positional index encoding into plain {period, value, dimensions} rows.

const ABS_BASE = "https://data.api.abs.gov.au";
const MAX_OBSERVATIONS_RETURNED = 200;

export const STATE_NAMES: Record<string, string> = {
  AUS: "Australia",
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  SA: "South Australia",
  WA: "Western Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
};

const STATE_REGION_CODE: Record<string, string> = {
  NSW: "1",
  VIC: "2",
  QLD: "3",
  SA: "4",
  WA: "5",
  TAS: "6",
  NT: "7",
  ACT: "8",
};

const SEX_CODE: Record<string, string> = {
  male: "1",
  female: "2",
  persons: "3",
};

export interface Observation {
  period: string;
  value: number | null;
  dimensions: Record<string, string>;
}

export interface DatasetResult {
  dataflow: string;
  observations: Observation[];
  observationCount: number;
  truncated: boolean;
  sourceUrl: string;
}

interface SdmxValue {
  id: string;
  name?: string;
}

interface SdmxDimension {
  id: string;
  name?: string;
  values: SdmxValue[];
}

interface SdmxResponse {
  data?: {
    dataSets?: Array<{
      series?: Record<
        string,
        { observations?: Record<string, [number | null, ...unknown[]]> }
      >;
      observations?: Record<string, [number | null, ...unknown[]]>;
    }>;
    structures?: Array<{
      dimensions?: {
        series?: SdmxDimension[];
        observation?: SdmxDimension[];
      };
    }>;
    structure?: {
      dimensions?: {
        series?: SdmxDimension[];
        observation?: SdmxDimension[];
      };
    };
  };
}

function flattenSdmxJson(payload: SdmxResponse): Observation[] {
  const structure = payload.data?.structures?.[0] ?? payload.data?.structure;
  const seriesDims = structure?.dimensions?.series ?? [];
  const obsDims = structure?.dimensions?.observation ?? [];
  const dataSet = payload.data?.dataSets?.[0];
  if (!dataSet || !structure) return [];

  const out: Observation[] = [];
  const seriesEntries = dataSet.series ? Object.entries(dataSet.series) : [];

  if (seriesEntries.length === 0 && dataSet.observations) {
    for (const [obsKey, obsValue] of Object.entries(dataSet.observations)) {
      out.push({
        period: decodeObsKey(obsKey, obsDims),
        value: typeof obsValue[0] === "number" ? obsValue[0] : null,
        dimensions: {},
      });
    }
    return out;
  }

  for (const [seriesKey, seriesData] of seriesEntries) {
    const dims = decodeSeriesKey(seriesKey, seriesDims);
    for (const [obsKey, obsValue] of Object.entries(
      seriesData.observations ?? {},
    )) {
      out.push({
        period: decodeObsKey(obsKey, obsDims),
        value: typeof obsValue[0] === "number" ? obsValue[0] : null,
        dimensions: dims,
      });
    }
  }
  return out;
}

function decodeSeriesKey(
  key: string,
  dims: SdmxDimension[],
): Record<string, string> {
  const parts = key.split(":");
  const out: Record<string, string> = {};
  for (let i = 0; i < parts.length && i < dims.length; i++) {
    const dim = dims[i];
    const idx = Number.parseInt(parts[i], 10);
    const value = dim.values[idx];
    if (value) out[dim.id] = value.name ?? value.id;
  }
  return out;
}

function decodeObsKey(key: string, dims: SdmxDimension[]): string {
  const parts = key.split(":");
  const labels = parts
    .map((p, i) => {
      const dim = dims[i];
      const idx = Number.parseInt(p, 10);
      return dim?.values[idx]?.id ?? p;
    })
    .filter((s) => s.length > 0);
  return labels.join(" ");
}

async function fetchSdmx(
  path: string,
  query: Record<string, string | undefined>,
): Promise<{ url: string; payload: SdmxResponse }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  params.set("format", "jsondata");
  const url = `${ABS_BASE}${path}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept:
        "application/vnd.sdmx.data+json;version=1.0.0,application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ABS API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }
  const payload = (await res.json()) as SdmxResponse;
  return { url, payload };
}

function trimObservations(observations: Observation[]) {
  if (observations.length <= MAX_OBSERVATIONS_RETURNED) {
    return { observations, truncated: false };
  }
  const sorted = [...observations].sort((a, b) =>
    a.period < b.period ? 1 : a.period > b.period ? -1 : 0,
  );
  return {
    observations: sorted.slice(0, MAX_OBSERVATIONS_RETURNED),
    truncated: true,
  };
}

function buildErpKey(region: string, sex: string): string {
  const sexCode = SEX_CODE[sex] ?? SEX_CODE.persons;
  if (region === "AUS") return `1.${sexCode}.TT.AUS.AUS.Q`;
  const code = STATE_REGION_CODE[region];
  if (!code) throw new Error(`Unknown region: ${region}`);
  return `1.${sexCode}.TT.STE.${code}.Q`;
}

export async function queryErp(opts: {
  region: string;
  sex: string;
  startPeriod?: string;
  endPeriod?: string;
}): Promise<DatasetResult> {
  const key = buildErpKey(opts.region, opts.sex);
  const { url, payload } = await fetchSdmx(`/data/ERP_Q/${key}`, {
    startPeriod: opts.startPeriod,
    endPeriod: opts.endPeriod,
  });
  const all = flattenSdmxJson(payload);
  const { observations, truncated } = trimObservations(all);
  return {
    dataflow: "ERP_Q",
    observations,
    observationCount: all.length,
    truncated,
    sourceUrl: url,
  };
}

export async function queryErpAllStates(opts: {
  sex: string;
  startPeriod?: string;
  endPeriod?: string;
}): Promise<DatasetResult> {
  const sexCode = SEX_CODE[opts.sex] ?? SEX_CODE.persons;
  const stateCodes = Object.values(STATE_REGION_CODE).join("+");
  const key = `1.${sexCode}.TT.STE.${stateCodes}.Q`;
  const { url, payload } = await fetchSdmx(`/data/ERP_Q/${key}`, {
    startPeriod: opts.startPeriod,
    endPeriod: opts.endPeriod,
  });
  const all = flattenSdmxJson(payload);
  const { observations, truncated } = trimObservations(all);
  return {
    dataflow: "ERP_Q",
    observations,
    observationCount: all.length,
    truncated,
    sourceUrl: url,
  };
}

export async function queryDataset(opts: {
  dataflow: string;
  key: string;
  startPeriod?: string;
  endPeriod?: string;
}): Promise<DatasetResult> {
  const { url, payload } = await fetchSdmx(
    `/data/${opts.dataflow}/${opts.key}`,
    {
      startPeriod: opts.startPeriod,
      endPeriod: opts.endPeriod,
    },
  );
  const all = flattenSdmxJson(payload);
  const { observations, truncated } = trimObservations(all);
  return {
    dataflow: opts.dataflow,
    observations,
    observationCount: all.length,
    truncated,
    sourceUrl: url,
  };
}

interface DataflowListResponse {
  data?: {
    dataflows?: Array<{
      id?: string;
      name?: string;
      names?: { en?: string };
      description?: string;
      descriptions?: { en?: string };
    }>;
  };
}

export async function listDataflows(search?: string): Promise<
  Array<{ id: string; name: string; description?: string }>
> {
  const url = `${ABS_BASE}/dataflow/ABS?format=jsondata`;
  const res = await fetch(url, {
    headers: {
      Accept:
        "application/vnd.sdmx.structure+json;version=1.0.0,application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`ABS dataflow list ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as DataflowListResponse;
  const items = payload.data?.dataflows ?? [];
  const flat = items.map((d) => ({
    id: d.id ?? "",
    name: d.name ?? d.names?.en ?? "",
    description: d.description ?? d.descriptions?.en,
  }));
  if (!search) return flat.slice(0, 50);
  const q = search.toLowerCase();
  return flat
    .filter(
      (d) =>
        d.id.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        (d.description ?? "").toLowerCase().includes(q),
    )
    .slice(0, 50);
}
