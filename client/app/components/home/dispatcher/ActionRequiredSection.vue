<script setup>
const requests = [
  { id: 102, equipment: 'Осмотр ВЭУ-3', source: 'Автоматическая', issue: 'Срок не задан' },
]

const columns = [
  { accessorKey: 'id', header: '№ заявки' },
  { accessorKey: 'equipment', header: 'Оборудование / работа' },
  { accessorKey: 'source', header: 'Источник' },
  { accessorKey: 'issue', header: 'Что требуется' },
  { id: 'actions', header: 'Действие' },
]

const filterOptions = [
  { label: 'Автоматическая', value: 'automatic' },
  { label: 'Ручная', value: 'manual' },
]
</script>

<template>
  <UCard class="bg-white ring-1 ring-brand/15">
    <h2 class="mb-4 text-lg font-semibold text-gray-900">Требует действия</h2>
    <TableToolbar :filter-options="filterOptions" />
    <UTable :data="requests" :columns="columns">
      <template #actions-cell="{ row }">
        <UButton :to="'/requests/' + row.original.id" variant="outline">Открыть</UButton>
      </template>
    </UTable>
  </UCard>
</template>
