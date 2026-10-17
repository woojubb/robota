import { ValueType } from '@opentelemetry/api';
import type { HrTime } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType } from '@opentelemetry/sdk-metrics';
import type { Histogram, MetricData } from '@opentelemetry/sdk-metrics';
import type { IOtelMetricSample } from '@robota-sdk/agent-telemetry-otel';

interface IPointGroup {
  readonly attributes: Record<string, string | number>;
  readonly values: number[];
}

/** A stable identity for an attribute set: sorted entries, so insertion order never splits a group. */
function attributesKey(attributes: Readonly<Record<string, string | number>>): string {
  return JSON.stringify(Object.entries(attributes).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

/**
 * Explicit buckets: a value counts in the first bucket whose inclusive upper bound it does not
 * exceed, and above the last bound in the extra overflow bucket, so counts has one slot more than
 * boundaries.
 */
function histogramOf(values: readonly number[], boundaries: readonly number[]): Histogram {
  const counts = new Array<number>(boundaries.length + 1).fill(0);
  for (const value of values) {
    const bucket = boundaries.findIndex((bound) => value <= bound);
    counts[bucket === -1 ? boundaries.length : bucket] += 1;
  }
  return {
    buckets: { boundaries: [...boundaries], counts },
    sum: values.reduce((total, value) => total + value, 0),
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * One OTLP delta metric per sample name, with one data point per distinct attribute set: counters
 * add up into sums, histograms collect the grouped values into buckets. `extraAttributes` is stamped
 * on every point first, so a sample's own attribute wins a clash. The first sample of a name decides
 * its instrument, unit and boundaries, which the projection keeps identical per name.
 */
export function aggregateMetricSamples(
  samples: readonly IOtelMetricSample[], extraAttributes: Readonly<Record<string, string>>,
  startTime: HrTime, endTime: HrTime,
): MetricData[] {
  const byName = new Map<string, { readonly first: IOtelMetricSample; readonly groups: Map<string, IPointGroup> }>();
  for (const sample of samples) {
    let entry = byName.get(sample.name);
    if (!entry) {
      entry = { first: sample, groups: new Map() };
      byName.set(sample.name, entry);
    }
    const attributes = { ...extraAttributes, ...sample.attributes };
    const key = attributesKey(attributes);
    const group = entry.groups.get(key);
    if (group) group.values.push(sample.value);
    else entry.groups.set(key, { attributes, values: [sample.value] });
  }
  return [...byName.values()].map(({ first, groups }): MetricData => {
    const points = [...groups.values()];
    if (first.instrument === 'counter') return {
      descriptor: { name: first.name, description: '', unit: first.unit, valueType: ValueType.INT },
      aggregationTemporality: AggregationTemporality.DELTA,
      dataPointType: DataPointType.SUM,
      isMonotonic: true,
      dataPoints: points.map(({ attributes, values }) => ({
        startTime, endTime, attributes, value: values.reduce((total, value) => total + value, 0),
      })),
    };
    return {
      descriptor: {
        name: first.name, description: '', unit: first.unit,
        valueType: first.unit === 's' ? ValueType.DOUBLE : ValueType.INT,
      },
      aggregationTemporality: AggregationTemporality.DELTA,
      dataPointType: DataPointType.HISTOGRAM,
      dataPoints: points.map(({ attributes, values }) => ({
        startTime, endTime, attributes, value: histogramOf(values, first.boundaries ?? []),
      })),
    };
  });
}
