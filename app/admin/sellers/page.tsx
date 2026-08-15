import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listSellers } from "@/features/admin/queries";
import { recordAdminAccess, requirePlatformAdmin } from "@/lib/admin/guard";
import { PLANS } from "@/lib/plans";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminSellersPage() {
  const admin = await requirePlatformAdmin();
  const result = await listSellers();

  // Listing every business is itself a cross-tenant read, so it is logged.
  await recordAdminAccess(admin, "sellers.list", null, {
    count: result.ok ? result.data.length : 0,
  });

  if (!result.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Could not load businesses</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {result.error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const sellers = result.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Businesses</h1>
        <p className="text-sm text-muted-foreground">
          {sellers.length === 0
            ? "No businesses yet."
            : `${sellers.length} ${sellers.length === 1 ? "business" : "businesses"}, newest first.`}
        </p>
      </div>

      {sellers.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              When someone signs up she will appear here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Cards on small screens, table from lg - same pattern as the app. */}
          <div className="grid gap-3 lg:hidden">
            {sellers.map((seller) => (
              <Card key={seller.workspaceId}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{seller.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {seller.ownerEmail}
                      </p>
                    </div>
                    <Badge variant="secondary">{PLANS[seller.plan].name}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {seller.city ?? "No city"} · joined{" "}
                    {formatDate(seller.createdAt)}
                  </p>
                  <p className="text-xs tabular-nums">
                    {seller.counts.contacts} customers ·{" "}
                    {seller.counts.products} products · {seller.counts.orders}{" "}
                    orders
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Customers</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellers.map((seller) => (
                  <TableRow key={seller.workspaceId}>
                    <TableCell>
                      <span className="font-medium">{seller.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        /store/{seller.slug}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {seller.ownerName ? (
                        <span className="block">{seller.ownerName}</span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {seller.ownerEmail}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {seller.city ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          seller.plan === "free" ? "secondary" : "default"
                        }
                      >
                        {PLANS[seller.plan].name}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {seller.counts.contacts}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {seller.counts.products}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {seller.counts.orders}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDate(seller.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
