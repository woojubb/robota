interface IValidationErrorsProps {
  errors: string[];
}

export function ValidationErrors({ errors }: IValidationErrorsProps) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs text-red-700">
      <ul className="list-disc list-inside space-y-1">
        {errors.map((error, index) => (
          <li key={index}>{error}</li>
        ))}
      </ul>
    </div>
  );
}
