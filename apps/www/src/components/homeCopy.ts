import enCopy from '@/messages/home/en.json';
import koCopy from '@/messages/home/ko.json';
import type { MarketingLocale } from '@/lib/marketing';
import type { ArchitectureLayerId, FeatureGroupId, FeatureId, PackageGroupId, PermissionMode } from './homeCatalog';

type Titled = { title: string; body: string };

export type HomeCopy = {
  beta: string;
  eyebrow: string;
  title: string;
  lead: string;
  sdkAction: string;
  cliAction: string;
  heroNote: string;
  heroVision: string;
  jumpLabel: string;
  jumpLinks: { features: string; cli: string; safety: string; architecture: string; install: string };
  proofEyebrow: string;
  proofTitle: string;
  proofLead: string;
  sdkLabel: string;
  cliLabel: string;
  diagramCaption: string;
  installLabel: string;
  exampleLabel: string;
  cliCodeLabel: string;
  cliPromptIntro: string;
  cliExpectedReply: string;
  copy: string;
  copied: string;
  copyFailed: string;
  exampleNote: string;
  codeSource: string;
  tasksEyebrow: string;
  tasksTitle: string;
  prereqLabel: string;
  tasks: readonly { title: string; body: string; needs: string; action: string }[];
  featuresEyebrow: string;
  featuresTitle: string;
  featuresLead: string;
  guideLink: string;
  sourceLink: string;
  featureGroups: Record<FeatureGroupId, Titled>;
  features: Record<FeatureId, Titled>;
  cliEyebrow: string;
  cliTitle: string;
  cliLead: string;
  cliFlows: readonly Titled[];
  shellLabel: string;
  sessionLabel: string;
  cliGuideLink: string;
  safetyEyebrow: string;
  safetyTitle: string;
  safetyLead: string;
  modeTableCaption: string;
  modeHeaders: readonly string[];
  modes: Record<PermissionMode, readonly string[]>;
  rulesLabel: string;
  safetyNotes: readonly Titled[];
  safetyLink: string;
  architectureEyebrow: string;
  architectureTitle: string;
  architectureLead: string;
  layers: Record<ArchitectureLayerId, string>;
  architectureLink: string;
  packagesTitle: string;
  packagesLead: string;
  packageGroups: Record<PackageGroupId, Titled>;
  packagesLink: string;
  installEyebrow: string;
  installTitle: string;
  installLead: string;
  installOptions: { npx: Titled; global: Titled; binary: Titled; sdk: Titled };
  binaryUnix: string;
  binaryWindows: string;
  releasesLink: string;
  fitEyebrow: string;
  fitTitle: string;
  fitLead: string;
  fitItems: readonly Titled[];
  fitLink: string;
  visionEyebrow: string;
  visionTitle: string;
  visionBody: string;
  roadmapNote: string;
  roadmapLink: string;
  faqEyebrow: string;
  faqTitle: string;
  faqs: readonly { question: string; answer: string }[];
  closeTitle: string;
  closeBody: string;
  sdkGuide: string;
};

/**
 * The homepage copy per locale. The text is localization data in `messages/home/<locale>.json`; this
 * module only types it. Both locales carry every key the page renders.
 */
export const homeCopy: Record<MarketingLocale, HomeCopy> = {
  en: enCopy,
  ko: koCopy,
};
