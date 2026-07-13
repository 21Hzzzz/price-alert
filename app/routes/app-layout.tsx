import { Activity, LogOut } from "lucide-react"
import { Outlet, useLocation, useNavigate } from "react-router"

import { AppSidebar } from "~/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "~/components/ui/breadcrumb"
import { Separator } from "~/components/ui/separator"
import { Button } from "~/components/ui/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar"

export default function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const pageTitle = location.pathname === "/price-monitoring" ? "价格监控" : location.pathname === "/access-logs" ? "访问日志" : "控制台"

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="size-3.5" />
            Bun service
            <Button
              aria-label="退出登录"
              size="icon-xs"
              variant="ghost"
              onClick={() => {
                void fetch("/api/auth/logout", { method: "POST" }).finally(() => navigate("/login", { replace: true }))
              }}
            >
              <LogOut />
            </Button>
          </div>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
