import type { IPlaygroundUsageStats } from './types';
import { FeatureStatus } from './feature-status';

export interface IFeaturesSectionProps {
  features: IPlaygroundUsageStats['features'];
}

export function FeaturesSection({ features }: IFeaturesSectionProps) {
  return (
    <div className="pt-3 border-t">
      <h4 className="text-sm font-medium mb-3">Available Features</h4>
      <div className="grid grid-cols-2 gap-2">
        <FeatureStatus label="Streaming" isEnabled={features.streaming} />
        <FeatureStatus label="Tools" isEnabled={features.tools} />
        <FeatureStatus
          label="Custom Templates"
          isEnabled={features.customTemplates}
          className="col-span-2"
        />
      </div>
    </div>
  );
}
