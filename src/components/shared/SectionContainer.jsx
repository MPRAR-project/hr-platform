const SectionContainer = ({ title, subtitle, action, children }) => (
  <div className="bg-white rounded-base shadow-md border border-border-primary">
    {(title || action) && (
      <div className="p-4xl border-b border-border-primary">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          {title && (
            <div>
              <h2 className="text-xl font-bold text-text-primary">{title}</h2>
              {subtitle && <p className="text-sm text-text-secondary mt-sm">{subtitle}</p>}
            </div>
          )}
          {action}
        </div>
      </div>
    )}
    {children}
  </div>
);

export default SectionContainer;