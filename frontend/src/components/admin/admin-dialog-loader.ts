import { lazy } from 'react'

type AdminDialogModule = Promise<{ default: typeof import('./AdminDialog')['AdminDialog'] }>

let adminDialogModule: AdminDialogModule | null = null

function loadAdminDialogModule(): AdminDialogModule {
  if (!adminDialogModule) {
    adminDialogModule = import('./AdminDialog').then(module => ({ default: module.AdminDialog }))
  }
  return adminDialogModule
}

export function preloadAdminDialog(): void {
  void loadAdminDialogModule()
}

export const AdminDialog = lazy(loadAdminDialogModule)
