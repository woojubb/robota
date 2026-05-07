import type { TPlaygroundProvider } from '../../../lib/playground/project-manager';

export interface ITemplate {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'tools' | 'creative' | 'business' | 'advanced';
  provider: TPlaygroundProvider;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  features: string[];
  code: string;
  estimatedTime: string;
  useCases: string[];
  config: {
    model: string;
    temperature: string;
  };
}

export interface ITemplateGalleryProps {
  onSelectTemplate: (template: ITemplate) => void;
  onClose?: () => void;
}
