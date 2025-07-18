'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { AuthGuard } from '@/components/auth/auth-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    User,
    Mail,
    Calendar,
    Settings,
    Camera,
    Save,
    AlertCircle,
    CheckCircle
} from 'lucide-react';
import { UserProfile } from '@/types/auth';
import { ProfileImageUpload } from '@/components/profile/profile-image-upload';

function ProfilePageContent() {
    const { user, userProfile, updateProfile, loading } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [formData, setFormData] = useState<{ displayName: string }>({
        displayName: userProfile?.displayName || '',
    });
    const [currentImageUrl, setCurrentImageUrl] = useState<string>(userProfile?.photoURL || '');

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (message) setMessage(null);
    };

    const handleSave = async () => {
        if (!user) return;

        setIsSaving(true);
        setMessage(null);

        try {
            await updateProfile({ displayName: formData.displayName });
            setMessage({ type: 'success', text: 'Profile updated successfully!' });
            setIsEditing(false);
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setFormData({
            displayName: userProfile?.displayName || '',
        });
        setIsEditing(false);
        setMessage(null);
    };

    const getSubscriptionBadgeColor = (plan?: string) => {
        switch (plan) {
            case 'enterprise': return 'bg-purple-100 text-purple-800';
            case 'pro': return 'bg-blue-100 text-blue-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="container mx-auto py-8 px-4 max-w-4xl">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold">Profile Settings</h1>
                        <p className="text-muted-foreground">
                            Manage your account information and preferences
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {isEditing ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={handleCancel}
                                    disabled={isSaving}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="min-w-[80px]"
                                >
                                    {isSaving ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4 mr-2" />
                                            Save
                                        </>
                                    )}
                                </Button>
                            </>
                        ) : (
                            <Button onClick={() => setIsEditing(true)}>
                                <Settings className="h-4 w-4 mr-2" />
                                Edit Profile
                            </Button>
                        )}
                    </div>
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

                {/* Profile Information */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Basic Information
                        </CardTitle>
                        <CardDescription>
                            Your basic profile information and avatar
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Profile Image Upload Section */}
                        {isEditing ? (
                            <ProfileImageUpload
                                currentImageUrl={currentImageUrl}
                                onImageUpdate={(newUrl) => setCurrentImageUrl(newUrl)}
                            />
                        ) : (
                            <div className="flex items-center gap-4">
                                <Avatar className="h-20 w-20">
                                    <AvatarImage src={currentImageUrl || userProfile?.photoURL || ''} alt={userProfile?.displayName || ''} />
                                    <AvatarFallback className="text-lg">
                                        {userProfile?.displayName?.charAt(0).toUpperCase() || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                                <div>
                                    <h3 className="text-lg font-medium">{userProfile?.displayName}</h3>
                                    <p className="text-sm text-muted-foreground">{userProfile?.email}</p>
                                    {userProfile?.subscription && (
                                        <Badge className={`mt-1 ${getSubscriptionBadgeColor(userProfile.subscription.plan)}`}>
                                            {userProfile.subscription.plan.charAt(0).toUpperCase() + userProfile.subscription.plan.slice(1)} Plan
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        )}

                        <Separator />

                        {/* Form Fields */}
                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="displayName">Display Name</Label>
                                <Input
                                    id="displayName"
                                    value={formData.displayName}
                                    onChange={(e) => handleInputChange('displayName', e.target.value)}
                                    disabled={!isEditing}
                                    placeholder="Enter your display name"
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    value={userProfile?.email}
                                    disabled
                                    className="bg-muted"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Email cannot be changed. Contact support if you need to update your email.
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    Account Created
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    {userProfile?.createdAt ? formatDate(userProfile.createdAt) : 'Unknown'}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Subscription Information */}
                <Card>
                    <CardHeader>
                        <CardTitle>Subscription & Billing</CardTitle>
                        <CardDescription>
                            Your current subscription status and billing information
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {userProfile?.subscription ? (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-medium">Current Plan</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {userProfile.subscription.plan.charAt(0).toUpperCase() + userProfile.subscription.plan.slice(1)} Plan
                                        </p>
                                    </div>
                                    <Badge className={getSubscriptionBadgeColor(userProfile.subscription.plan)}>
                                        {userProfile.subscription.status.toUpperCase()}
                                    </Badge>
                                </div>

                                {userProfile.subscription.currentPeriodEnd && (
                                    <div>
                                        <h4 className="font-medium text-sm">Next Billing Date</h4>
                                        <p className="text-sm text-muted-foreground">
                                            {formatDate(userProfile.subscription.currentPeriodEnd)}
                                        </p>
                                    </div>
                                )}

                                <Separator />

                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm">
                                        Change Plan
                                    </Button>
                                    <Button variant="outline" size="sm">
                                        Billing History
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <h3 className="font-medium mb-2">No Active Subscription</h3>
                                <p className="text-sm text-muted-foreground mb-4">
                                    You are currently on the free plan. Upgrade to unlock more features.
                                </p>
                                <Button>
                                    View Plans
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function ProfilePage() {
    return (
        <AuthGuard>
            <ProfilePageContent />
        </AuthGuard>
    );
} 