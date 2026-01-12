import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Users, Smartphone, Wifi, WifiOff, Shield, UserPlus, Key, ArrowLeft, Settings, UserX, UserCheck } from "lucide-react";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CurrentUser {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
}

interface AdminStats {
  totalUsers: number;
  totalAccounts: number;
  connectedAccounts: number;
  disconnectedAccounts: number;
}

interface AdminUser {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
  isEnabled: boolean;
  createdAt: string;
}

interface AdminAccount {
  id: number;
  userId: number;
  label: string;
  phoneNumber: string | null;
  status: string;
  ownerUsername: string;
  isConnected: boolean;
  createdAt: string;
}

interface AppSettings {
  signupDisabled: boolean;
}

export default function AdminPage() {
  const { toast } = useToast();
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");

  const { data: currentUser } = useQuery<CurrentUser>({
    queryKey: ["/api/auth/me"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: accounts, isLoading: accountsLoading } = useQuery<AdminAccount[]>({
    queryKey: ["/api/admin/accounts"],
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["/api/admin/settings"],
  });

  const toggleAdminMutation = useMutation({
    mutationFn: async ({ userId, isAdmin }: { userId: number; isAdmin: boolean }) => {
      return apiRequest("PATCH", `/api/admin/users/${userId}`, { isAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ userId, isEnabled }: { userId: number; isEnabled: boolean }) => {
      return apiRequest("PATCH", `/api/admin/users/${userId}`, { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: { username: string; email: string; password: string; isAdmin: boolean }) => {
      return apiRequest("POST", "/api/admin/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setCreateUserOpen(false);
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewIsAdmin(false);
      toast({ title: "User created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create user", description: error.message, variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: number; password: string }) => {
      return apiRequest("PATCH", `/api/admin/users/${userId}/password`, { password });
    },
    onSuccess: () => {
      setChangePasswordOpen(false);
      setPasswordValue("");
      setSelectedUserId(null);
      toast({ title: "Password changed successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to change password", description: error.message, variant: "destructive" });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: { signupDisabled: boolean }) => {
      return apiRequest("PATCH", "/api/admin/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update settings", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateUser = () => {
    if (!newUsername || !newEmail || !newPassword) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    createUserMutation.mutate({ username: newUsername, email: newEmail, password: newPassword, isAdmin: newIsAdmin });
  };

  const handleChangePassword = () => {
    if (!selectedUserId || !passwordValue) {
      toast({ title: "Password is required", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate({ userId: selectedUserId, password: passwordValue });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Admin Panel</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold" data-testid="text-total-users">
                    {statsLoading ? "..." : stats?.totalUsers || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Smartphone className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Accounts</p>
                  <p className="text-2xl font-bold" data-testid="text-total-accounts">
                    {statsLoading ? "..." : stats?.totalAccounts || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <Wifi className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Connected</p>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-connected">
                    {statsLoading ? "..." : stats?.connectedAccounts || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <WifiOff className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Disconnected</p>
                  <p className="text-2xl font-bold text-red-600" data-testid="text-disconnected">
                    {statsLoading ? "..." : stats?.disconnectedAccounts || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="users" className="w-full">
          <TabsList>
            <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
            <TabsTrigger value="accounts" data-testid="tab-accounts">WhatsApp Accounts</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>User Management</CardTitle>
                <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-create-user">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Create User
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New User</DialogTitle>
                      <DialogDescription>
                        Add a new user to the system.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                          id="username"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="Enter username"
                          data-testid="input-new-username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="Enter email"
                          data-testid="input-new-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter password"
                          data-testid="input-new-password"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          id="isAdmin"
                          checked={newIsAdmin}
                          onCheckedChange={setNewIsAdmin}
                          data-testid="switch-new-admin"
                        />
                        <Label htmlFor="isAdmin">Make Admin</Label>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateUserOpen(false)}>Cancel</Button>
                      <Button onClick={handleCreateUser} disabled={createUserMutation.isPending} data-testid="button-submit-create">
                        {createUserMutation.isPending ? "Creating..." : "Create User"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <p className="text-muted-foreground">Loading users...</p>
                ) : (
                  <div className="space-y-4">
                    {users?.map((user) => (
                      <div
                        key={user.id}
                        className={`flex items-center justify-between p-4 border rounded-lg ${!user.isEnabled ? 'opacity-60 bg-muted/50' : ''}`}
                        data-testid={`row-user-${user.id}`}
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="font-medium">{user.username}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {user.isAdmin && <Badge variant="secondary">Admin</Badge>}
                            {!user.isEnabled && <Badge variant="destructive">Disabled</Badge>}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {user.id === currentUser?.id ? (
                            <Badge variant="outline">You</Badge>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Admin</span>
                                <Switch
                                  checked={user.isAdmin}
                                  onCheckedChange={(checked) =>
                                    toggleAdminMutation.mutate({ userId: user.id, isAdmin: checked })
                                  }
                                  disabled={toggleAdminMutation.isPending}
                                  data-testid={`switch-admin-${user.id}`}
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleEnabledMutation.mutate({ userId: user.id, isEnabled: !user.isEnabled })}
                                disabled={toggleEnabledMutation.isPending}
                                data-testid={`button-toggle-enabled-${user.id}`}
                              >
                                {user.isEnabled ? (
                                  <UserX className="h-4 w-4 text-orange-500" />
                                ) : (
                                  <UserCheck className="h-4 w-4 text-green-500" />
                                )}
                              </Button>
                              <Dialog open={changePasswordOpen && selectedUserId === user.id} onOpenChange={(open) => {
                                setChangePasswordOpen(open);
                                if (!open) setSelectedUserId(null);
                              }}>
                                <DialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedUserId(user.id)}
                                    data-testid={`button-change-password-${user.id}`}
                                  >
                                    <Key className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Change Password</DialogTitle>
                                    <DialogDescription>
                                      Set a new password for user "{user.username}".
                                    </DialogDescription>
                                  </DialogHeader>
                                  <div className="py-4">
                                    <Label htmlFor="newPassword">New Password</Label>
                                    <Input
                                      id="newPassword"
                                      type="password"
                                      value={passwordValue}
                                      onChange={(e) => setPasswordValue(e.target.value)}
                                      placeholder="Enter new password (min 6 characters)"
                                      data-testid="input-change-password"
                                    />
                                  </div>
                                  <DialogFooter>
                                    <Button variant="outline" onClick={() => setChangePasswordOpen(false)}>Cancel</Button>
                                    <Button onClick={handleChangePassword} disabled={changePasswordMutation.isPending} data-testid="button-submit-password">
                                      {changePasswordMutation.isPending ? "Changing..." : "Change Password"}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {users?.length === 0 && (
                      <p className="text-muted-foreground text-center py-8">No users found</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="accounts" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All WhatsApp Accounts</CardTitle>
              </CardHeader>
              <CardContent>
                {accountsLoading ? (
                  <p className="text-muted-foreground">Loading accounts...</p>
                ) : (
                  <div className="space-y-4">
                    {accounts?.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                        data-testid={`row-account-${account.id}`}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              account.isConnected ? "bg-green-500" : "bg-red-500"
                            }`}
                          />
                          <div>
                            <p className="font-medium">{account.label}</p>
                            <p className="text-sm text-muted-foreground">
                              Owner: {account.ownerUsername}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {account.phoneNumber && (
                            <span className="text-sm text-muted-foreground">
                              {account.phoneNumber}
                            </span>
                          )}
                          <Badge variant={account.isConnected ? "default" : "secondary"}>
                            {account.isConnected ? "Connected" : "Disconnected"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                    {accounts?.length === 0 && (
                      <p className="text-muted-foreground text-center py-8">No accounts found</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  App Settings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">Disable Public Signup</p>
                      <p className="text-sm text-muted-foreground">
                        When enabled, new users can only be created by admins
                      </p>
                    </div>
                    <Switch
                      checked={settings?.signupDisabled || false}
                      onCheckedChange={(checked) =>
                        updateSettingsMutation.mutate({ signupDisabled: checked })
                      }
                      disabled={updateSettingsMutation.isPending}
                      data-testid="switch-disable-signup"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
