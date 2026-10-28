<script setup>
import { equipmentItems } from '~/data/equipment'
import { useUserStore } from '~/stores/user'

const route = useRoute()
const userStore = useUserStore()
const equipment = computed(() => equipmentItems.find((item) => item.id === String(route.params.id)))

const historyColumns = [
  { accessorKey: 'date', header: 'Дата окончания ремонта' },
  { accessorKey: 'work', header: 'Выполненные работы' },
  { accessorKey: 'state', header: 'Состояние в истории' },
]
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <template v-if="equipment">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900">{{ equipment.name }}</h1>
          <p class="mt-1 text-sm text-gray-600">ID {{ equipment.id }}</p>
        </div>
        <UButton
          v-if="userStore.role === 'dispatcher'"
          :to="{ path: '/requests/new', query: { equipmentId: equipment.id } }"
        >
          Создать заявку
        </UButton>
      </div>

      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">Атрибуты оборудования</h2>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-sm text-gray-600">Наименование оборудования</dt><dd class="text-gray-900">{{ equipment.name }}</dd></div>
          <div><dt class="text-sm text-gray-600">Типовой ОР</dt><dd class="text-gray-900">{{ equipment.typicalObject }}</dd></div>
          <div><dt class="text-sm text-gray-600">Дата ввода в эксплуатацию</dt><dd class="text-gray-900">{{ equipment.commissionedAt }}</dd></div>
          <div><dt class="text-sm text-gray-600">Дата выпуска</dt><dd class="text-gray-900">{{ equipment.manufacturedAt }}</dd></div>
          <div><dt class="text-sm text-gray-600">График работы</dt><dd class="text-gray-900">{{ equipment.schedule }}</dd></div>
          <div><dt class="text-sm text-gray-600">Срок полезного использования</dt><dd class="text-gray-900">{{ equipment.usefulLife }}</dd></div>
          <div><dt class="text-sm text-gray-600">Инвентарный №</dt><dd class="text-gray-900">{{ equipment.inventoryNumber }}</dd></div>
          <div><dt class="text-sm text-gray-600">Комментарий</dt><dd class="text-gray-900">{{ equipment.comment || 'Неизвестно' }}</dd></div>
        </dl>
      </UCard>

      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-4 text-lg font-semibold text-gray-900">История обслуживания и ремонтов</h2>
        <UTable v-if="equipment.history.length" :data="equipment.history" :columns="historyColumns" />
        <p v-else class="text-sm text-gray-600">Записей пока нет.</p>
      </UCard>

      <UCard class="bg-white ring-1 ring-brand/15">
        <h2 class="mb-2 text-lg font-semibold text-gray-900">Текущие заявки</h2>
        <p class="text-sm text-gray-600">Заявок пока нет.</p>
      </UCard>
    </template>

    <h1 v-else class="text-2xl font-semibold text-gray-900">Оборудование не найдено</h1>
  </main>
</template>


