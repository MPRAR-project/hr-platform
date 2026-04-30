/**
 * VirtualizedList Component
 * Optimized list rendering for large datasets (10K+ items)
 * Uses react-window for efficient rendering
 */

import { FixedSizeList, VariableSizeList } from 'react-window';
import { useMemo } from 'react';

/**
 * VirtualizedList - Fixed height items
 */
export function VirtualizedList({
    items,
    height = 600,
    itemHeight = 50,
    renderItem,
    className = '',
    overscanCount = 5,
    ...props
}) {
    const itemData = useMemo(() => ({
        items,
        renderItem
    }), [items, renderItem]);

    if (!items || items.length === 0) {
        return (
            <div className={`flex items-center justify-center p-8 text-gray-500 ${className}`}>
                No items to display
            </div>
        );
    }

    return (
        <FixedSizeList
            height={height}
            itemCount={items.length}
            itemSize={itemHeight}
            itemData={itemData}
            overscanCount={overscanCount}
            className={className}
            {...props}
        >
            {({ index, style, data }) => (
                <div style={style}>
                    {data.renderItem(data.items[index], index)}
                </div>
            )}
        </FixedSizeList>
    );
}

/**
 * VirtualizedVariableList - Variable height items
 */
export function VirtualizedVariableList({
    items,
    height = 600,
    getItemHeight,
    renderItem,
    className = '',
    overscanCount = 5,
    ...props
}) {
    const itemData = useMemo(() => ({
        items,
        renderItem
    }), [items, renderItem]);

    // Calculate item sizes
    const itemSizes = useMemo(() => {
        return items.map((item, index) => getItemHeight(item, index));
    }, [items, getItemHeight]);

    if (!items || items.length === 0) {
        return (
            <div className={`flex items-center justify-center p-8 text-gray-500 ${className}`}>
                No items to display
            </div>
        );
    }

    return (
        <VariableSizeList
            height={height}
            itemCount={items.length}
            itemSize={(index) => itemSizes[index]}
            itemData={itemData}
            overscanCount={overscanCount}
            className={className}
            {...props}
        >
            {({ index, style, data }) => (
                <div style={style}>
                    {data.renderItem(data.items[index], index)}
                </div>
            )}
        </VariableSizeList>
    );
}

/**
 * VirtualizedGrid - Grid layout with virtual scrolling
 */
export function VirtualizedGrid({
    items,
    height = 600,
    columnCount = 3,
    itemHeight = 200,
    renderItem,
    className = '',
    ...props
}) {
    const itemData = useMemo(() => ({
        items,
        renderItem,
        columnCount
    }), [items, renderItem, columnCount]);

    const rowCount = Math.ceil(items.length / columnCount);

    if (!items || items.length === 0) {
        return (
            <div className={`flex items-center justify-center p-8 text-gray-500 ${className}`}>
                No items to display
            </div>
        );
    }

    return (
        <FixedSizeList
            height={height}
            itemCount={rowCount}
            itemSize={itemHeight}
            itemData={itemData}
            className={className}
            {...props}
        >
            {({ index, style, data }) => {
                const startIndex = index * data.columnCount;
                const endIndex = Math.min(startIndex + data.columnCount, data.items.length);
                const rowItems = data.items.slice(startIndex, endIndex);

                return (
                    <div style={style} className="flex gap-4">
                        {rowItems.map((item, colIndex) => (
                            <div key={startIndex + colIndex} className="flex-1">
                                {data.renderItem(item, startIndex + colIndex)}
                            </div>
                        ))}
                    </div>
                );
            }}
        </FixedSizeList>
    );
}

export default VirtualizedList;
