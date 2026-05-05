import { Check } from 'lucide-react';

import { Card, CardContent } from '../../ui/card';

export function ErrorPanelEmptyState() {
  return (
    <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
      <CardContent className="flex items-center space-x-2 py-4">
        <Check className="w-5 h-5 text-green-500" />
        <span className="text-green-700 dark:text-green-300 font-medium">
          No errors or warnings detected
        </span>
      </CardContent>
    </Card>
  );
}
