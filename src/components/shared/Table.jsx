const Table = ({ children }) => <div className="overflow-x-auto"><table className="w-full">{children}</table></div>;
const TableHeader = ({ children }) => <thead className="bg-background-secondary border-b border-border-primary"><tr>{children}</tr></thead>;
const TableHeaderCell = ({ children }) => <th className="text-left px-4xl py-2xl text-xs font-semibold text-text-secondary uppercase tracking-wider">{children}</th>;
const TableBody = ({ children }) => <tbody className="divide-y divide-border-primary">{children}</tbody>;
const TableRow = ({ children }) => <tr className="hover:bg-background-secondary transition-colors">{children}</tr>;
const TableCell = ({ children }) => <td className="px-4xl py-2xl">{children}</td>;


export { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell };