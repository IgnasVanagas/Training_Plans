# React Query Cache Invalidation Analysis - User Profile Data

## 1. WHERE USER/PROFILE DATA IS FETCHED (/users/me endpoint)

### Primary User Profile Query
- **[Dashboard.tsx](frontend/src/pages/Dashboard.tsx#L181)** (L181-188)
  - Main entry point for authenticated users
  - `queryKey: ["me"]`
  - No staleTime set (default: 0, always stale)
- **[ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx#L17)** (L17-28)
  - Session validation query used for all protected routes
  - `queryKey: ["protected-route-session"]`
  - `refetchOnMount: true`, `staleTime: 0` (fresh on every mount)
  - Validates user session and syncs language preference

### Additional Locations with /users/me queries
- **[AppSidebarLayout.tsx](frontend/src/components/AppSidebarLayout.tsx#L37)** (L37-44)
  - Older component (likely legacy)
  - `staleTime: 1000 * 60 * 10` (10 mins)
  
- **[TrainingCalendar.tsx](frontend/src/components/TrainingCalendar.tsx#L274)** (L274)
  - Direct `api.get("/users/me")` call (not useQuery)
  
- **[ActivityDetailPage.tsx](frontend/src/pages/ActivityDetailPage.tsx#L142)** (L142)
  - Direct `api.get("/users/me")` call (not useQuery)
  
- **[ActivitiesView.tsx](frontend/src/components/ActivitiesView.tsx#L90-98)** (L90-98)
  - `queryKey: ["me"]`
  - `staleTime: 1000 * 60 * 30` (30 mins)
  
- **[LoginPage.tsx](frontend/src/pages/LoginPage.tsx#L107)** (L107)
  - Email verification call during login
  - Direct `api.get<{ email?: string | null }>("/users/me")` 
  
- **[ShareToChatModal.tsx](frontend/src/components/ShareToChatModal.tsx#L46)** (L46)
  - `queryKey: ["me"]` (not shown but referenced)
  
- **[ComparisonPage.tsx](frontend/src/pages/ComparisonPage.tsx#L493)** (L493-494)
  - `queryKey: ['me']`

---

## 2. REACT QUERY CACHE INVALIDATION ISSUES

### ❌ **PROBLEM: No Cache Invalidation After Login**

**[LoginPage.tsx](frontend/src/pages/LoginPage.tsx#L87-133)** (L87-133)
- `loginMutation.onSuccess` handler:
  - Calls `markAuthSessionActive(data.access_token)` 
  - Verifies user email by calling `/users/me` endpoint
  - **DOES NOT** invalidate query cache
  - **DOES NOT** call `queryClient.invalidateQueries("me")`
  - Simply navigates to `/dashboard` with `replace: true`
  - **RISK**: Old cached user data persists if login happens while app is still loaded

### Cache Invalidation After Profile Updates ✅

**[Dashboard.tsx](frontend/src/pages/Dashboard.tsx#L361-363)** (L361-363)
- `profileUpdateMutation.onSuccess`:
  ```typescript
  queryClient.setQueryData(["me"], data);
  queryClient.invalidateQueries({ queryKey: ["me"] });
  queryClient.invalidateQueries({ queryKey: ["protected-route-session"] });
  ```
  - Correctly invalidates both "me" and "protected-route-session" queries

**[DashboardAthleteProfileTab.tsx](frontend/src/pages/dashboard/DashboardAthleteProfileTab.tsx#L133)** (L133)
- `uploadPictureMutation.onSuccess`:
  ```typescript
  queryClient.invalidateQueries({ queryKey: ["me"] });
  ```
  - Correctly invalidates "me" query after picture upload

### ❌ **PROBLEM: No Cache Invalidation After Logout**

**[authSession.ts](frontend/src/utils/authSession.ts#L88-90)** (L88-90)
- `optimisticSignOut`:
  ```typescript
  clearAuthSession();
  sendBestEffortLogout(buildLogoutUrl(options?.apiBaseUrl));
  window.location.replace(options?.redirectTo || "/");
  ```
  - Does NOT clear React Query cache
  - Simply clears local auth state and redirects
  - Page reload does NOT happen, old cached data remains in memory until page refresh

**[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L289-296)** (L289-296)
- Logout button calls `optimisticSignOut()` with no cache clearing

---

## 3. USER DISPLAY NAME (meDisplayName) LOCATIONS

### Dashboard Page
- **[Dashboard.tsx](frontend/src/pages/Dashboard.tsx#L720)** (L720-726)
  - Computed via useMemo based on `meQuery.data`
  - Falls back to `me.email` if no name
  - Passes as prop to `DashboardLayoutShell`

```typescript
const meDisplayName = useMemo(() => {
  if (!me) return "";
  return (me.profile?.first_name || me.profile?.last_name)
    ? `${me.profile?.first_name || ""} ${me.profile?.last_name || ""}`.trim()
    : me.email;
}, [me]);
```

### DashboardLayoutShell (Primary Display)
- **[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L73, L91)** (L73, L91 - prop definition)
- **[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L211)** (L211)
  - Avatar name prop
- **[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L281)** (L281)
  - Menu button label
- **[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L286)** (L286)
  - Menu header label
- **[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L323)** (L323)
  - Avatar initials: `meDisplayName[0]?.toUpperCase() || "U"`
- **[DashboardLayoutShell.tsx](frontend/src/pages/dashboard/DashboardLayoutShell.tsx#L326)** (L326)
  - Sidebar profile name display

### AppSidebarLayout (Legacy)
- **[AppSidebarLayout.tsx](frontend/src/components/AppSidebarLayout.tsx#L45)** (L45)
  - Computed directly from `me?.profile?.first_name / last_name`
- **[AppSidebarLayout.tsx](frontend/src/components/AppSidebarLayout.tsx#L74)** (L74)
  - Avatar name prop
- **[AppSidebarLayout.tsx](frontend/src/components/AppSidebarLayout.tsx#L78)** (L78)
  - Text display in sidebar

---

## 4. KEY FINDINGS & RISKS

### ⚠️ **Critical Issues**

1. **No Cache Invalidation on Login**
   - User data fetched before login is NOT cleared
   - If app is open in browser during login elsewhere, old user data persists
   - New login will show old cached user's data until manual refresh

2. **No Cache Invalidation on Logout**
   - Cache cleared via `clearAuthSession()` but NOT React Query
   - Old user's data remains in cache after logout
   - Page redirect to "/" doesn't clear cache (no full page reload)
   
3. **Inconsistent staleTime Settings**
   - `Dashboard.meQuery`: `staleTime: 0` (always stale) ✓ Good
   - `ProtectedRoute.sessionValidationQuery`: `staleTime: 0` + `refetchOnMount: true` ✓ Good
   - `AppSidebarLayout`: `staleTime: 1000 * 60 * 10` (10 mins) ⚠️ Potential issue
   - `ActivitiesView`: `staleTime: 1000 * 60 * 30` (30 mins) ⚠️ Potential issue

### 📋 **Integration Points**

- Backend `/users/me` endpoint: [backend/app/routers/users.py](backend/app/routers/users.py#L291) (L291-305)
  - Returns `Cache-Control: private, max-age=300`
  - Includes normalized profile data and coach summaries

### 🔍 **Recommendations**

1. Add cache invalidation to `loginMutation.onSuccess` in [LoginPage.tsx](frontend/src/pages/LoginPage.tsx#L87)
2. Add queryClient cache clear to `optimisticSignOut` in [authSession.ts](frontend/src/utils/authSession.ts#L88)
3. Consider adding a middleware or hook to invalidate cache on auth state changes
4. Standardize `staleTime` for all user profile queries to 0 or use `refetchOnMount: true`

