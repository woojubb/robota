import { ExternalLink } from 'lucide-react';

import { Button } from '../../ui/button';

interface IIssueDocumentationLinkProps {
  documentation: string;
}

export function IssueDocumentationLink({ documentation }: IIssueDocumentationLinkProps) {
  return (
    <div>
      <Button variant="outline" size="sm" className="w-full" asChild>
        <a
          href={documentation}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-2"
        >
          <ExternalLink className="w-4 h-4" />
          <span>View Documentation</span>
        </a>
      </Button>
    </div>
  );
}
