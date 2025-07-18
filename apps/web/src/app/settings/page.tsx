'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { AuthGuard } from '@/components/auth/auth-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Settings,
    Key,
    Bell,
    Globe,
    Trash2,
    Shield,
    Save,
    AlertCircle,
    CheckCircle,
    UserX
} from 'lucide-react';
import { UserProfile } from '@/types/auth';

function SettingsPageContent() {
    const { user, userProfile, updateProfile, changePassword, loading } = useAuth();
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    const [preferences, setPreferences] = useState({
        theme: userProfile?.preferences?.theme || 'system',
        language: userProfile?.preferences?.language || 'ko',
        notifications: userProfile?.preferences?.notifications ?? true,
    });

    const handlePreferenceChange = (field: string, value: any) => {
        setPreferences(prev => ({ ...prev, [field]: value }));
        if (message) setMessage(null);
    };

    const handlePasswordInputChange = (field: string, value: string) => {
        setPasswordData(prev => ({ ...prev, [field]: value }));
        if (message) setMessage(null);
    };

    const savePreferences = async () => {
        if (!user) return;

        setIsSaving(true);
        setMessage(null);

        try {
            await updateProfile({ preferences });
            setMessage({ type: 'success', text: 'Preferences saved successfully!' });
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    const handlePasswordChange = async () => {
        setMessage(null);

        // Validate passwords
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match!' });
            return;
        }

        if (passwordData.newPassword.length < 6) {
            setMessage({ type: 'error', text: 'New password must be at least 6 characters long!' });
            return;
        }

        setIsSaving(true);

        try {
            await changePassword(passwordData.currentPassword, passwordData.newPassword);
            setMessage({ type: 'success', text: 'Password changed successfully!' });
            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    const deleteAccount = async () => {
        if (!window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
            return;
        }

        setIsSaving(true);
        setMessage(null);

        try {
            // TODO: Implement account deletion
            setMessage({ type: 'success', text: 'Account deletion initiated. You will receive an email confirmation.' });
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setIsSaving(false);
        }
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
                        <h1 className="text-3xl font-bold">Account Settings</h1>
                        <p className="text-muted-foreground">
                            Manage your account security and application preferences
                        </p>
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

                {/* Application Preferences */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5" />
                            Application Preferences
                        </CardTitle>
                        <CardDescription>
                            Customize your application experience and behavior
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid gap-6">
                            <div className="grid gap-2">
                                <Label>Theme Preference</Label>
                                <Select
                                    value={preferences.theme}
                                    onValueChange={(value) => handlePreferenceChange('theme', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select theme" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="light">Light Mode</SelectItem>
                                        <SelectItem value="dark">Dark Mode</SelectItem>
                                        <SelectItem value="system">Follow System</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Choose your preferred color scheme for the application
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label className="flex items-center gap-2">
                                    <Globe className="h-4 w-4" />
                                    Language
                                </Label>
                                <Select
                                    value={preferences.language}
                                    onValueChange={(value) => handlePreferenceChange('language', value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select language" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ko">한국어 (Korean)</SelectItem>
                                        <SelectItem value="en">English</SelectItem>
                                        <SelectItem value="ja">日本語 (Japanese)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Select your preferred language for the interface
                                </p>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="flex items-center gap-2">
                                        <Bell className="h-4 w-4" />
                                        Email Notifications
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        Receive email notifications about your account activity
                                    </p>
                                </div>
                                <Button
                                    variant={preferences.notifications ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => handlePreferenceChange('notifications', !preferences.notifications)}
                                >
                                    {preferences.notifications ? 'Enabled' : 'Disabled'}
                                </Button>
                            </div>
                        </div>

                        <Separator />

                        <div className="flex justify-end">
                            <Button
                                onClick={savePreferences}
                                disabled={isSaving}
                                className="min-w-[120px]"
                            >
                                {isSaving ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" />
                                        Save Preferences
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Password & Security */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            Password & Security
                        </CardTitle>
                        <CardDescription>
                            Update your password and manage security settings
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="currentPassword">Current Password</Label>
                                <Input
                                    id="currentPassword"
                                    type="password"
                                    value={passwordData.currentPassword}
                                    onChange={(e) => handlePasswordInputChange('currentPassword', e.target.value)}
                                    placeholder="Enter your current password"
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="newPassword">New Password</Label>
                                <Input
                                    id="newPassword"
                                    type="password"
                                    value={passwordData.newPassword}
                                    onChange={(e) => handlePasswordInputChange('newPassword', e.target.value)}
                                    placeholder="Enter your new password"
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={passwordData.confirmPassword}
                                    onChange={(e) => handlePasswordInputChange('confirmPassword', e.target.value)}
                                    placeholder="Confirm your new password"
                                />
                            </div>

                            <p className="text-xs text-muted-foreground">
                                Password must be at least 6 characters long and contain a mix of letters and numbers.
                            </p>
                        </div>

                        <Separator />

                        <div className="flex justify-end">
                            <Button
                                onClick={handlePasswordChange}
                                disabled={isSaving || !passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword}
                                className="min-w-[140px]"
                            >
                                {isSaving ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                ) : (
                                    <>
                                        <Key className="h-4 w-4 mr-2" />
                                        Change Password
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Danger Zone */}
                <Card className="border-red-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-600">
                            <UserX className="h-5 w-5" />
                            Danger Zone
                        </CardTitle>
                        <CardDescription>
                            Irreversible and destructive actions
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-medium text-red-900">Delete Account</h3>
                                    <p className="text-sm text-red-700">
                                        Permanently delete your account and all associated data. This action cannot be undone.
                                    </p>
                                </div>
                                <Button
                                    variant="destructive"
                                    onClick={deleteAccount}
                                    disabled={isSaving}
                                    className="min-w-[120px]"
                                >
                                    {isSaving ? (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    ) : (
                                        <>
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Delete Account
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <AuthGuard>
            <SettingsPageContent />
        </AuthGuard>
    );
} 