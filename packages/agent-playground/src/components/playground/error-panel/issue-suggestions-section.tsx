import { Lightbulb } from 'lucide-react';

import { Button } from '../../ui/button';

interface IIssueSuggestionsSectionProps {
  suggestions: string[];
  onFixSuggestion?: (fix: string) => void;
}

export function IssueSuggestionsSection({
  suggestions,
  onFixSuggestion,
}: IIssueSuggestionsSectionProps) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-2 flex items-center space-x-1">
        <Lightbulb className="w-4 h-4" />
        <span>Suggested Fixes</span>
      </h4>
      <div className="space-y-2">
        {suggestions.map((suggestion, suggestionIndex) => (
          <div
            key={suggestionIndex}
            className="flex items-start space-x-2 p-2 rounded-lg bg-background border"
          >
            <Lightbulb className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <span className="text-sm flex-1">{suggestion}</span>
            {onFixSuggestion && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => onFixSuggestion(suggestion)}
              >
                Apply
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
