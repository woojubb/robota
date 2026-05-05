import { Bug } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';

interface IErrorPanelSummaryProps {
  errorCount: number;
  warningCount: number;
}

export function ErrorPanelSummary({ errorCount, warningCount }: IErrorPanelSummaryProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2">
          <Bug className="w-5 h-5" />
          <span>Issues Summary</span>
        </CardTitle>
        <CardDescription>
          Found {errorCount} error{errorCount !== 1 ? 's' : ''} and {warningCount} warning
          {warningCount !== 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex space-x-4">
          {errorCount > 0 && (
            <Badge variant="destructive">
              {errorCount} Error{errorCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
            >
              {warningCount} Warning{warningCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
