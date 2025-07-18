import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config';

export interface UploadResult {
    url: string;
    fileName: string;
}

/**
 * Upload a profile image to Firebase Storage
 * @param file The image file to upload
 * @param userId The user's unique ID
 * @returns Promise with the download URL and filename
 */
export const uploadProfileImage = async (file: File, userId: string): Promise<UploadResult> => {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        throw new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
        throw new Error('File size too large. Maximum size is 5MB.');
    }

    try {
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const fileExtension = file.name.split('.').pop() || 'jpg';
        const fileName = `profile-${userId}-${timestamp}.${fileExtension}`;

        // Create reference to storage location
        const storageRef = ref(storage, `profile-images/${fileName}`);

        // Upload file
        const uploadResult = await uploadBytes(storageRef, file, {
            contentType: file.type,
            customMetadata: {
                userId: userId,
                uploadedAt: timestamp.toString(),
            }
        });

        // Get download URL
        const downloadURL = await getDownloadURL(uploadResult.ref);

        return {
            url: downloadURL,
            fileName: fileName
        };
    } catch (error: any) {
        console.error('Error uploading profile image:', error);
        throw new Error(`Failed to upload image: ${error.message}`);
    }
};

/**
 * Delete a profile image from Firebase Storage
 * @param fileName The name of the file to delete
 * @returns Promise that resolves when deletion is complete
 */
export const deleteProfileImage = async (fileName: string): Promise<void> => {
    try {
        const storageRef = ref(storage, `profile-images/${fileName}`);
        await deleteObject(storageRef);
    } catch (error: any) {
        console.error('Error deleting profile image:', error);
        // Don't throw error for delete operations as the file might not exist
    }
};

/**
 * Extract filename from a Firebase Storage URL
 * @param url The Firebase Storage download URL
 * @returns The filename or null if not a Firebase Storage URL
 */
export const extractFileNameFromUrl = (url: string): string | null => {
    try {
        const match = url.match(/profile-images%2F([^?]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    } catch (error) {
        console.error('Error extracting filename from URL:', error);
        return null;
    }
};

/**
 * Validate and prepare an image file for upload
 * @param file The file to validate
 * @returns Promise that resolves if file is valid
 */
export const validateImageFile = (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
        // Check file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            reject(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
            return;
        }

        // Check file size (max 5MB)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
            reject(new Error('File size too large. Maximum size is 5MB.'));
            return;
        }

        // Validate image dimensions (optional)
        const img = new Image();
        img.onload = () => {
            // Check minimum dimensions
            if (img.width < 100 || img.height < 100) {
                reject(new Error('Image dimensions too small. Minimum size is 100x100 pixels.'));
                return;
            }

            // Check maximum dimensions
            if (img.width > 2048 || img.height > 2048) {
                reject(new Error('Image dimensions too large. Maximum size is 2048x2048 pixels.'));
                return;
            }

            resolve();
        };

        img.onerror = () => {
            reject(new Error('Invalid image file.'));
        };

        img.src = URL.createObjectURL(file);
    });
}; 