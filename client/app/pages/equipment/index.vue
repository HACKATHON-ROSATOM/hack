<script setup>
import { equipmentItems } from '~/data/equipment'

const search = ref('')
const type = ref('all')

const typeOptions = [
  { label: 'Все виды', value: 'all' },
  ...equipmentItems.map((item) => ({ label: item.name, value: item.name })),
]

const visibleEquipment = computed(() => equipmentItems.filter((item) => {
  const query = search.value.trim().toLowerCase()
  const matchesSearch = [item.id, item.name, item.inventoryNumber]
    .join(' ')
    .toLowerCase()
    .includes(query)
  return matchesSearch && (type.value === 'all' || item.name === type.value)
}))

const columns = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: 'Оборудование' },
  { accessorKey: 'inventoryNumber', header: 'Инвентарный №' },
  { id: 'actions', header: 'Действие' },
]
</script>

<template>
  <main class="mx-auto max-w-6xl space-y-6 px-4 py-10">
    <div>
      <h1 class="text-2xl font-semibold text-gray-900">Оборудование</h1>
    </div>

    <UCard class="bg-white ring-1 ring-brand/15">
      <div class="mb-4 flex flex-wrap gap-3">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Поиск по названию или ID" aria-label="Поиск оборудования" class="w-72" />
        <USelect v-model="type" :items="typeOptions" value-key="value" aria-label="Вид оборудования" class="w-52" />
      </div>

      <UTable :data="visibleEquipment" :columns="columns">
        <template #actions-cell="{ row }">
          <UButton :to="'/equipment/' + row.original.id" variant="outline">Открыть</UButton>
        </template>
      </UTable>
    </UCard>
  </main>
</template>


