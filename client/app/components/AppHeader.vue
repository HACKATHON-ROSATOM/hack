<script setup>
import { useUserStore } from '~/stores/user'

const route = useRoute()
const userStore = useUserStore()

const links = [
  { label: 'Сводка', href: '/' },
  { label: 'Оборудование', href: '/equipment' },
  { label: 'Заявки', href: '/requests' },
  { label: 'Мониторинг', href: '/monitoring' },
]

const roleOptions = [
  { label: 'Дежурный', value: 'dispatcher' },
  { label: 'Сервисный инженер', value: 'engineer' },
  { label: 'Технический директор', value: 'director' },
]

const isActive = (href) =>
  href === '/'
    ? route.path === '/'
    : route.path === href || route.path.startsWith(`${href}/`)
</script>

<template>
  <header class="flex h-20 items-center justify-between border-b border-brand/15 bg-white px-4">
    <nav class="flex items-center gap-6" aria-label="Основная навигация">
      <NuxtLink
        v-for="link in links"
        :key="link.href"
        :to="link.href"
        class="border-b-2 pb-1 text-base font-medium hover:text-brand-hover"
        :class="isActive(link.href) ? 'border-brand text-brand' : 'border-transparent text-gray-600'"
      >
        {{ link.label }}
      </NuxtLink>
    </nav>

    <USelect
      :model-value="userStore.role"
      :items="roleOptions"
      value-key="value"
      label-key="label"
      aria-label="Роль пользователя"
      class="w-72"
      @update:model-value="userStore.setRole"
    />
  </header>
</template>

