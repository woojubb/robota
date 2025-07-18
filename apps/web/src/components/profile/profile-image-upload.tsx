'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Camera, Upload, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { uploadProfileImage, validateImageFile, extractFileNameFromUrl, deleteProfileImage } from '@/lib/firebase/storage-service';
import { useAuth } from '@/contexts/auth-context';
import { trackEvents } from '@/lib/analytics/google-analytics';
import { ProfileImage } from '@/components/ui/optimized-image';

interface ProfileImageUploadProps {
    currentImageUrl?: string;
    onImageUpdate: (newImageUrl: string) => void;
    className?: string;
}

export function ProfileImageUpload({
    currentImageUrl,
    onImageUpdate,
    className = ""
}: ProfileImageUploadProps) {
    const { user, userProfile, updateProfile } = useAuth();
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (file: File) => {
        if (!user) {
            setMessage({ type: 'error', text: 'You must be logged in to upload images.' });
            return;
        }

        setMessage(null);
        setUploading(true);

        try {
            // Validate the file
            await validateImageFile(file);

            // Delete previous image if it exists
            if (currentImageUrl) {
                const fileName = extractFileNameFromUrl(currentImageUrl);
                if (fileName) {
                    await deleteProfileImage(fileName);
                }
            }

            // Upload new image
            const uploadResult = await uploadProfileImage(file, user.uid);

            // Update user profile
            await updateProfile({ photoURL: uploadResult.url });

            // Track analytics event
            trackEvents.uploadProfileImage();

            // Notify parent component
            onImageUpdate(uploadResult.url);

            setMessage({ type: 'success', text: 'Profile image updated successfully!' });
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            handleFileSelect(file);
        }
    };

    const handleDragOver = (event: React.DragEvent) => {
        event.preventDefault();
        setDragActive(true);
    };

    const handleDragLeave = (event: React.DragEvent) => {
        event.preventDefault();
        setDragActive(false);
    };

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragActive(false);

        const file = event.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) {
            handleFileSelect(file);
        } else {
            setMessage({ type: 'error', text: 'Please drop a valid image file.' });
        }
    };

    const openFileDialog = () => {
        fileInputRef.current?.click();
    };

    const getInitials = (name?: string | null) => {
        if (!name) return 'U';
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className={`space-y-4 ${className}`}>
            {/* Image Preview */}
            <div className="flex items-center gap-4">
                <div className="relative">
                    {currentImageUrl || userProfile?.photoURL ? (
                        <ProfileImage
                            src={currentImageUrl || userProfile?.photoURL || ''}
                            alt={userProfile?.displayName || 'Profile'}
                            size="md"
                            className="h-20 w-20"
                        />
                    ) : (
                        <Avatar className="h-20 w-20">
                            <AvatarFallback className="text-lg">
                                {getInitials(userProfile?.displayName)}
                            </AvatarFallback>
                        </Avatar>
                    )}

                    {uploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                            <Loader2 className="h-6 w-6 text-white animate-spin" />
                        </div>
                    )}
                </div>

                <div className="flex-1">
                    <h3 className="font-medium">Profile Picture</h3>
                    <p className="text-sm text-muted-foreground">
                        Upload a new avatar. JPG, PNG, or WebP. Max 5MB.
                    </p>
                </div>
            </div>

            {/* Upload Area */}
            <div
                className={`relative border-2 border-dashed rounded-lg p-6 transition-colors ${dragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/50'
                    } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className="text-center space-y-2">
                    <div className="mx-auto w-12 h-12 flex items-center justify-center rounded-full bg-muted">
                        {uploading ? (
                            <Loader2 className="h-6 w-6 animate-spin" />
                        ) : (
                            <Upload className="h-6 w-6" />
                        )}
                    </div>

                    <div>
                        <p className="text-sm font-medium">
                            {uploading ? 'Uploading...' : 'Drop your image here, or'}
                        </p>
                        <Button
                            variant="link"
                            className="p-0 h-auto text-sm"
                            onClick={openFileDialog}
                            disabled={uploading}
                        >
                            browse files
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        Supports: JPG, PNG, WebP (max 5MB)
                    </p>
                </div>
            </div>

            {/* Hidden File Input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
                disabled={uploading}
            />

            {/* Quick Upload Button */}
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={openFileDialog}
                    disabled={uploading}
                    className="flex-1"
                >
                    <Camera className="h-4 w-4 mr-2" />
                    {uploading ? 'Uploading...' : 'Choose Photo'}
                </Button>
            </div>

            {/* Status Message */}
            {message && (
                <Alert className={message.type === 'success' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                    {message.type === 'success' ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                    )}
                    <AlertDescription className={message.type === 'success' ? 'text-green-700' : 'text-red-700'}>
                        {message.text}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
} 