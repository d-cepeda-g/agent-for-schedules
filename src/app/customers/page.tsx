"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, History } from "lucide-react";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  preferredLanguage: string;
  createdAt: string;
  _count: { calls: number };
};

type FormData = {
  name: string;
  phone: string;
  email: string;
  notes: string;
  preferredLanguage: string;
};

const EMPTY_FORM: FormData = {
  name: "",
  phone: "",
  email: "",
  notes: "",
  preferredLanguage: "English",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadCustomers() {
      const params = search ? `?q=${encodeURIComponent(search)}` : "";
      try {
        const res = await fetch(`/api/customers${params}`);
        if (!res.ok) {
          if (active) {
            setCustomers([]);
            setLoading(false);
          }
          return;
        }
        const data = (await res.json()) as Customer[];
        if (active) {
          setCustomers(data);
          setLoading(false);
        }
      } catch {
        if (active) {
          setCustomers([]);
          setLoading(false);
        }
      }
    }

    void loadCustomers();
    return () => {
      active = false;
    };
  }, [search, refreshKey]);

  function refreshCustomers() {
    setLoading(true);
    setRefreshKey((value) => value + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    let response: Response;
    if (editingId) {
      response = await fetch(`/api/customers/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
    } else {
      response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
    }

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      alert(data?.error || "Failed to save contact");
      return;
    }

    setFormData(EMPTY_FORM);
    setEditingId(null);
    setDialogOpen(false);
    refreshCustomers();
  }

  function openEdit(customer: Customer) {
    setFormData({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      notes: customer.notes,
      preferredLanguage: customer.preferredLanguage || "English",
    });
    setEditingId(customer.id);
    setDialogOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contact? This will also remove their calls."))
      return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error || "Failed to delete contact");
        return;
      }
      refreshCustomers();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">
            Manage your contacts
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setFormData(EMPTY_FORM);
              setEditingId(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Contact" : "New Contact"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="+1234567890"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Preferred language</Label>
                <Select
                  value={formData.preferredLanguage}
                  onValueChange={(value) =>
                    setFormData({ ...formData, preferredLanguage: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="Spanish">Spanish</SelectItem>
                    <SelectItem value="German">German</SelectItem>
                    <SelectItem value="French">French</SelectItem>
                    <SelectItem value="Turkish">Turkish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                />
              </div>
              <Button type="submit" className="w-full">
                {editingId ? "Update" : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => {
                setLoading(true);
                setSearch(e.target.value);
              }}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-muted-foreground">
              Loading...
            </p>
          ) : customers.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No contacts yet. Add your first one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      {customer.name}
                    </TableCell>
                    <TableCell>{customer.phone}</TableCell>
                    <TableCell>{customer.email || "—"}</TableCell>
                    <TableCell>{customer.preferredLanguage || "English"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {customer._count.calls}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Link href={`/customers/${customer.id}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View history"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(customer)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete contact"
                          aria-label="Delete contact"
                          disabled={deletingId === customer.id}
                          onClick={() => handleDelete(customer.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
