export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'gray',
      warning: 'yellow',
      error: 'red',
      success: 'green',
    },
    button: {
      defaultVariants: { size: 'xl' },
    },
    input: {
      defaultVariants: { size: 'xl' },
    },
    select: {
      defaultVariants: { size: 'xl' },
    },
    textarea: {
      defaultVariants: { size: 'xl' },
    },
    checkbox: {
      defaultVariants: { size: 'xl' },
    },
    formField: {
      defaultVariants: { size: 'xl' },
    },
    table: {
      slots: {
        th: 'text-center',
        td: 'text-center',
      },
    },
  },
})
