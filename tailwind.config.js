module.exports = {
    content: ["./src/**/*.{js,ts,jsx,tsx,html,mdx}"],
    darkMode: "class",
    theme: {
        screens: {
            sm: '640px',
            md: '768px',
            lg: '1024px',
            xl: '1280px',
            '2xl': '1536px'
        },
        extend: {
            colors: {
                /* Primary Text Colors */
                text: {
                    primary: "var(--text-primary)",
                    secondary: "var(--text-secondary)",
                    tertiary: "var(--text-tertiary)",
                    'accent-blue': "var(--text-accent-blue)",
                    'accent-dark': "var(--text-accent-dark)",
                    'accent-green': "var(--text-accent-green)",
                    'accent-purple': "var(--text-accent-purple)",
                    'accent-red': "var(--text-accent-red)"
                },
                /* Background Colors */
                background: {
                    primary: "var(--bg-primary)",
                    secondary: "var(--bg-secondary)",
                    'overlay-light': "var(--bg-overlay-light)",
                    'overlay-medium': "var(--bg-overlay-medium)",
                    'accent-blue': "var(--bg-accent-blue)",
                    'accent-green': "var(--bg-accent-green)",
                    'accent-purple-light': "var(--bg-accent-purple-light)",
                    'accent-purple': "var(--bg-accent-purple)",
                    'accent-red': "var(--bg-accent-red)"
                },
                /* Border Colors */
                border: {
                    primary: "var(--border-primary)",
                    secondary: "var(--border-secondary)",
                    'accent-green': "var(--border-accent-green)",
                    'accent-purple-alt': "var(--border-accent-purple-alt)",
                    'accent-purple': "var(--border-accent-purple)",
                    neutral: "var(--border-neutral)",
                    'accent-red': "var(--border-accent-red)"
                },
                /* Component-specific colors */
                sidebar: {
                    border: "var(--sidebar-border)"
                },
                header: {
                    border: "var(--header-border)"
                },
                search: {
                    background: "var(--search-bg)",
                    border: "var(--search-border)"
                }
            },
            fontSize: {
                'xs': 'var(--font-size-xs)',
                'sm': 'var(--font-size-sm)',
                'base': 'var(--font-size-base)',
                'md': 'var(--font-size-md)',
                'lg': 'var(--font-size-lg)',
                'xl': 'var(--font-size-xl)'
            },
            fontWeight: {
                'normal': 'var(--font-weight-normal)',
                'medium': 'var(--font-weight-medium)',
                'semibold': 'var(--font-weight-semibold)',
                'bold': 'var(--font-weight-bold)'
            },
            lineHeight: {
                'xs': 'var(--line-height-xs)',
                'sm': 'var(--line-height-sm)',
                'base': 'var(--line-height-base)',
                'md': 'var(--line-height-md)',
                'lg': 'var(--line-height-lg)',
                'xl': 'var(--line-height-xl)',
                '2xl': 'var(--line-height-2xl)'
            },
            spacing: {
                'xs': 'var(--spacing-xs)',
                'sm': 'var(--spacing-sm)',
                'base': 'var(--spacing-base)',
                'md': 'var(--spacing-md)',
                'lg': 'var(--spacing-lg)',
                'xl': 'var(--spacing-xl)',
                '2xl': 'var(--spacing-2xl)',
                '3xl': 'var(--spacing-3xl)',
                '4xl': 'var(--spacing-4xl)',
                '5xl': 'var(--spacing-5xl)',
                '6xl': 'var(--spacing-6xl)',
                '7xl': 'var(--spacing-7xl)',
                '8xl': 'var(--spacing-8xl)',
                '9xl': 'var(--spacing-9xl)',
                '10xl': 'var(--spacing-10xl)'
            },
            borderRadius: {
                'sm': 'var(--radius-sm)',
                'base': 'var(--radius-base)',
                'md': 'var(--radius-md)',
                'lg': 'var(--radius-lg)',
                'xl': 'var(--radius-xl)',
                '2xl': 'var(--radius-2xl)',
                '3xl': 'var(--radius-3xl)'
            },
            width: {
                'sidebar': 'var(--sidebar-width)'
            }
        }
    },
    plugins: []
};