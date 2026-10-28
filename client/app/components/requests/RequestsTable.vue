<script setup>
defineProps({ requests: { type: Array, required: true } })
const columns = [
  { accessorKey: 'ticketNumber', header: '№' },
  { accessorKey: 'kind', header: 'Тип' },
  { accessorKey: 'equipment', header: 'Объект' },
  { accessorKey: 'priorityLabel', header: 'Приоритет' },
  { id: 'due', header: 'Срок' },
  { id: 'assignee', header: 'Исполнитель' },
  { id: 'status', header: 'Статус' },
  { id: 'actions', header: 'Действие' },
]
</script>

<template>
  <UTable :data="requests" :columns="columns">
    <template #due-cell="{ row }"><span :class="row.original.isOverdue ? 'font-medium text-red-500' : 'text-gray-900'">{{ row.original.due }}</span></template>
    <template #assignee-cell="{ row }">{{ row.original.assignee || 'Не назначен' }}</template>
    <template #status-cell="{ row }">{{ row.original.statusLabel }} <span v-if="row.original.isOverdue" class="text-red-500">(просрочена)</span></template>
    <template #actions-cell="{ row }"><UButton :to="'/requests/' + row.original.id" variant="outline">Открыть</UButton></template>
  </UTable>
</template>
