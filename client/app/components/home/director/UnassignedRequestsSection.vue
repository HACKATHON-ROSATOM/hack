<script setup>
const requests = [
  { id: 102, equipment: 'Осмотр ВЭУ-3', status: 'Без исполнителя' },
]

const columns = [
  { accessorKey: 'id', header: '№ заявки' },
  { accessorKey: 'equipment', header: 'Оборудование / работа' },
  { accessorKey: 'status', header: 'Статус' },
  { id: 'actions', header: 'Действие' },
]
</script>

<template>
  <UCard class="bg-white ring-1 ring-brand/15">
    <h2 class="mb-4 text-lg font-semibold text-gray-900">Заявки без исполнителя</h2>
    <TableToolbar />
    <UTable :data="requests" :columns="columns">
      <template #actions-cell="{ row }">
        <UButton :to="`/requests/${row.original.id}`" variant="outline">Назначить</UButton>
      </template>
    </UTable>
  </UCard>
</template>

