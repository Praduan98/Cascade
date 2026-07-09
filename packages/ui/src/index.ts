// ---- Theme ----
export { ThemeProvider, useTheme } from './theme/ThemeProvider'
export type { Theme, Resolved } from './theme/ThemeProvider'
export { ThemeButton } from './theme/ThemeButton'

// ---- Primitives (global token classes) ----
export { Button } from './Button'
export type { ButtonVariant, ButtonSize } from './Button'
export { Pill } from './Pill'
export type { PillStatus } from './Pill'
export { Tag } from './Tag'
export type { TagTone } from './Tag'
export { Chip } from './Chip'
export type { ChipTone } from './Chip'
export { Card, Panel } from './Surface'
export { Kbd } from './Kbd'

// ---- Forms ----
export { Field } from './Field'
export { Input, Textarea } from './Input'
export type { InputState } from './Input'
export { Select } from './Select'
export { Switch } from './Switch'
export { Seg } from './Seg'
export type { SegOption } from './Seg'

// ---- Feedback ----
export { Alert } from './Alert'
export type { AlertVariant } from './Alert'
export { EmptyState } from './EmptyState'
export { ToastProvider, useToast } from './Toast'
export type { ToastVariant, ToastOptions } from './Toast'

// ---- Identity / members ----
export { Avatar } from './Avatar'
export { Member } from './Member'
export { RoleBadge } from './RoleBadge'
export type { Role } from './RoleBadge'
export { ProvChip, ProvMono } from './ProvChip'

// ---- Overlays (Radix-backed) ----
export { Dialog, DialogRoot, DialogTrigger, DialogClose } from './Dialog'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './DropdownMenu'
export { Popover, PopoverTrigger, PopoverContent, PopoverClose, PopoverAnchor } from './Popover'
export { Tooltip, TooltipProvider } from './Tooltip'

// ---- App shell ----
export { Topbar } from './shell/Topbar'
export { TopNavLink } from './shell/TopNavLink'
export { AppShell } from './shell/AppShell'
export { SideNav, NavGroup, NavItem } from './shell/SideNav'
export { WorkspaceSwitcher } from './shell/WorkspaceSwitcher'
export { BrandGlyph } from './shell/BrandGlyph'
