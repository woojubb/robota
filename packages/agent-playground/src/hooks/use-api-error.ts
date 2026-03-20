import { useToast } from './use-toast';
import { WebLogger } from '../lib/web-logger';

interface IApiLikeError {
  code?: string;
  message?: string;
}

function isApiLikeError(value: object): value is IApiLikeError {
  if (!value) return false;
  const v = value as { code?: unknown; message?: unknown };
  if (typeof v.code !== 'undefined' && typeof v.code !== 'string') return false;
  if (typeof v.message !== 'undefined' && typeof v.message !== 'string') return false;
  return true;
}

export const useApiError = () => {
  const { toast } = useToast();

  const handleError = (error: Error | IApiLikeError, customMessage?: string) => {
    WebLogger.error('API Error', {
      error: error instanceof Error ? error.message : (error.message ?? 'Unknown error'),
    });

    if (!(error instanceof Error) && isApiLikeError(error) && typeof error.code === 'string') {
      // Handle specific API errors
      switch (error.code) {
        case 'NETWORK_ERROR':
          toast({
            title: 'Connection Error',
            description: 'Unable to connect to the server. Please check your internet connection.',
            variant: 'destructive',
          });
          break;
        case 'TIMEOUT_ERROR':
          toast({
            title: 'Request Timeout',
            description: 'The request took too long to complete. Please try again.',
            variant: 'destructive',
          });
          break;
        case 'MAX_RETRIES_EXCEEDED':
          toast({
            title: 'Service Unavailable',
            description: 'The service is temporarily unavailable. Please try again later.',
            variant: 'destructive',
          });
          break;
        default:
          // Show custom message or the error message
          toast({
            title: 'Error',
            description: customMessage || error.message || 'An unexpected error occurred.',
            variant: 'destructive',
          });
      }
    } else {
      // Handle other errors
      toast({
        title: 'Error',
        description:
          customMessage ||
          (error instanceof Error
            ? error.message
            : (error.message ?? 'An unexpected error occurred. Please try again.')),
        variant: 'destructive',
      });
    }
  };

  return { handleError };
};
