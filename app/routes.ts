import { index, layout, route, type RouteConfig } from "@react-router/dev/routes"

export default [
  index("routes/index.tsx"),
  route("login", "routes/login.tsx"),
  layout("routes/app-layout.tsx", [
    route("price-monitoring", "routes/price-monitoring.tsx"),
    route("access-logs", "routes/access-logs.tsx"),
  ]),
] satisfies RouteConfig
