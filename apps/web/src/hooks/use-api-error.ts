import { useToast } from './use-toast';
import { ApiClientError } from '@/lib/api-client';

export const useApiError = () => {
    const { toast } = useToast();

    const handleError = (error: unknown, customMessage?: string) => {
        console.error('API Error:', error);

        if (error instanceof ApiClientError) {
            // Handle specific API errors
            switch (error.code) {
                case 'NETWORK_ERROR':
                    toast({
                        title: "Connection Error",
                        description: "Unable to connect to the server. Please check your internet connection.",
                        variant: "destructive",
                    });
                    break;
                case 'TIMEOUT_ERROR':
                    toast({
                        title: "Request Timeout",
                        description: "The request took too long to complete. Please try again.",
                        variant: "destructive",
                    });
                    break;
                case 'MAX_RETRIES_EXCEEDED':
                    toast({
                        title: "Service Unavailable",
                        description: "The service is temporarily unavailable. Please try again later.",
                        variant: "destructive",
                    });
                    break;
                default:
                    // Show custom message or the error message
                    toast({
                        title: "Error",
                        description: customMessage || error.message || "An unexpected error occurred.",
                        variant: "destructive",
                    });
            }
        } else if (error instanceof Error) {
            // Handle other types of errors
            toast({
                title: "Error",
                description: customMessage || error.message || "An unexpected error occurred.",
                variant: "destructive",
            });
        } else {
            // Handle unknown errors
            toast({
                title: "Error",
                description: customMessage || "An unexpected error occurred. Please try again.",
                variant: "destructive",
            });
        }
    };

    return { handleError };
}; 