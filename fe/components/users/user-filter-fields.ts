import { FilterField } from '@/lib/types/filter-schema'

export const USER_FILTER_FIELDS: FilterField[] = [
  {
    id: 'email',
    label: 'Email',
    field: 'email',
    type: 'text',
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'],
  },
  {
    id: 'firstName',
    label: 'First Name',
    field: 'firstName',
    type: 'text',
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with'],
  },
  {
    id: 'lastName',
    label: 'Last Name',
    field: 'lastName',
    type: 'text',
    operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with'],
  },
  {
    id: 'locked',
    label: 'Account Status',
    field: 'locked',
    type: 'boolean',
    operators: ['equals'],
    options: [
      { label: 'Locked', value: true },
      { label: 'Active', value: false },
    ],
  },
  {
    id: 'emailVerified',
    label: 'Email Verified',
    field: 'emailVerified',
    type: 'boolean',
    operators: ['equals'],
    options: [
      { label: 'Verified', value: true },
      { label: 'Not Verified', value: false },
    ],
  },
  {
    id: 'roles',
    label: 'Role',
    field: 'roles',
    type: 'multiselect',
    operators: ['in', 'not_in'],
    options: [
      { label: 'Super Admin', value: 'super_admin' },
      { label: 'Organization Owner', value: 'org_owner' },
      { label: 'Organization Admin', value: 'org_admin' },
      { label: 'User', value: 'user' },
    ],
  },
  {
    id: 'createdAt',
    label: 'Created Date',
    field: 'createdAt',
    type: 'date',
    operators: [
      'equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
    ],
  },
  {
    id: 'updatedAt',
    label: 'Last Updated',
    field: 'updatedAt',
    type: 'date',
    operators: [
      'equals',
      'greater_than',
      'less_than',
      'greater_than_or_equal',
      'less_than_or_equal',
      'between',
    ],
  },
  {
    id: 'organizationId',
    label: 'Organization',
    field: 'organizationId',
    type: 'select',
    operators: ['equals', 'not_equals', 'in', 'not_in'],
    options: [],
  },
]

/** Org-admin subset: no organization filter, no platform-only assignable roles. */
export const USER_FILTER_FIELDS_ORG_ADMIN = USER_FILTER_FIELDS.map((field) => {
  if (field.id === 'organizationId') {
    return null
  }
  if (field.id === 'roles') {
    return {
      ...field,
      options:
        field.options?.filter(
          (option) => option.value !== 'super_admin'
        ) || [],
    }
  }
  return field
}).filter((field): field is FilterField => field !== null)
