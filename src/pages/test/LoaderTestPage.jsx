import React, { useState, useEffect } from 'react';
import Loader from '../../components/ui/Loader';
import Button from '../../components/ui/Button';
import Header from '../../components/layout/Header';

const LoaderTestPage = () => {
  const [showFullScreen, setShowFullScreen] = useState(false);
  const [selectedSize, setSelectedSize] = useState('md');
  const [selectedVariant, setSelectedVariant] = useState('spinner');
  const [showText, setShowText] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isProgressAnimating, setIsProgressAnimating] = useState(false);

  const sizes = ['sm', 'md', 'lg'];
  const variants = ['spinner', 'pulse', 'wave', 'skeleton', 'progress'];

  // Simulate progress animation
  useEffect(() => {
    if (isProgressAnimating) {
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            setIsProgressAnimating(false);
            return 0;
          }
          return prev + 2;
        });
      }, 50);
      return () => clearInterval(interval);
    }
  }, [isProgressAnimating]);

  return (
    <>
      <Header
        title="Loader Test Page"
        subtitle="Test professional SaaS loader variants"
      />
      
      <div className="flex-1 mt-2 overflow-y-auto sm:p-4 md:p-3xl scrollbar-custom">
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-white rounded-base shadow-lg p-6">
            <h2 className="text-xl font-bold text-text-primary mb-4">Loader Controls</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Size Selection */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Size
                </label>
                <div className="flex gap-2 flex-wrap">
                  {sizes.map((size) => (
                    <Button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      variant={selectedSize === size ? 'gradient' : 'outline-secondary'}
                      size="sm"
                    >
                      {size.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Variant Selection */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Variant
                </label>
                <div className="flex gap-2 flex-wrap">
                  {variants.map((variant) => (
                    <Button
                      key={variant}
                      onClick={() => {
                        setSelectedVariant(variant);
                        if (variant === 'progress') {
                          setProgress(0);
                        }
                      }}
                      variant={selectedVariant === variant ? 'gradient' : 'outline-secondary'}
                      size="sm"
                    >
                      {variant.charAt(0).toUpperCase() + variant.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Text Toggle */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Options
                </label>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => setShowText(!showText)}
                    variant={showText ? 'gradient' : 'outline-secondary'}
                    size="sm"
                  >
                    {showText ? 'Hide Text' : 'Show Text'}
                  </Button>
                  {selectedVariant === 'progress' && (
                    <Button
                      onClick={() => {
                        setIsProgressAnimating(!isProgressAnimating);
                        if (!isProgressAnimating) {
                          setProgress(0);
                        }
                      }}
                      variant={isProgressAnimating ? 'gradient' : 'outline-secondary'}
                      size="sm"
                    >
                      {isProgressAnimating ? 'Stop' : 'Animate'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Full Screen Toggle */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Display
                </label>
                <Button
                  onClick={() => setShowFullScreen(!showFullScreen)}
                  variant={showFullScreen ? 'gradient' : 'outline-secondary'}
                  size="sm"
                >
                  {showFullScreen ? 'Inline' : 'Full Screen'}
                </Button>
              </div>
            </div>
          </div>

          {/* Loader Examples */}
          {!showFullScreen && (
            <>
              {/* Current Selection */}
              <div className="bg-white rounded-base shadow-lg p-6">
                <h2 className="text-xl font-bold text-text-primary mb-6">Current Selection</h2>
                
                <div className="border border-border-secondary rounded-base p-8">
                  <div className="flex items-center justify-center min-h-[200px]">
                    <Loader
                      size={selectedSize}
                      variant={selectedVariant}
                      text={showText ? 'Loading...' : ''}
                      progress={selectedVariant === 'progress' ? progress : null}
                    />
                  </div>
                  <div className="mt-4 text-sm text-text-secondary text-center">
                    <p><strong>Size:</strong> {selectedSize} | <strong>Variant:</strong> {selectedVariant}</p>
                    {selectedVariant === 'progress' && (
                      <p className="mt-2"><strong>Progress:</strong> {progress}%</p>
                    )}
                  </div>
                </div>
              </div>

              {/* All Variants Showcase */}
              <div className="bg-white rounded-base shadow-lg p-6">
                <h2 className="text-xl font-bold text-text-primary mb-6">All Variants</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {variants.map((variant) => (
                    <div key={variant} className="border border-border-secondary rounded-base p-6 space-y-4">
                      <h3 className="text-lg font-semibold text-text-primary capitalize">
                        {variant}
                      </h3>
                      <div className="flex items-center justify-center min-h-[120px]">
                        <Loader 
                          size={selectedSize} 
                          variant={variant}
                          progress={variant === 'progress' ? 65 : null}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Real-world Usage Examples */}
              <div className="bg-white rounded-base shadow-lg p-6">
                <h2 className="text-xl font-bold text-text-primary mb-6">Real-world Usage Examples</h2>
                
                <div className="space-y-6">
                  {/* Page Loading */}
                  <div className="border border-border-secondary rounded-base p-6">
                    <h4 className="text-md font-semibold text-text-primary mb-4">Page Loading</h4>
                    <Loader size="lg" variant="spinner" text="Loading page..." />
                  </div>

                  {/* Data Fetching */}
                  <div className="border border-border-secondary rounded-base p-6">
                    <h4 className="text-md font-semibold text-text-primary mb-4">Data Fetching</h4>
                    <Loader size="md" variant="pulse" text="Fetching employee data..." />
                  </div>

                  {/* Content Skeleton */}
                  <div className="border border-border-secondary rounded-base p-6">
                    <h4 className="text-md font-semibold text-text-primary mb-4">Content Loading (Skeleton)</h4>
                    <div className="space-y-4">
                      <Loader size="md" variant="skeleton" />
                      <Loader size="md" variant="skeleton" />
                    </div>
                  </div>

                  {/* Progress Upload */}
                  <div className="border border-border-secondary rounded-base p-6">
                    <h4 className="text-md font-semibold text-text-primary mb-4">File Upload Progress</h4>
                    <Loader size="md" variant="progress" progress={75} text="Uploading document..." />
                  </div>

                  {/* Wave Animation */}
                  <div className="border border-border-secondary rounded-base p-6">
                    <h4 className="text-md font-semibold text-text-primary mb-4">Processing</h4>
                    <Loader size="lg" variant="wave" text="Processing request..." />
                  </div>
                </div>
              </div>

              {/* Code Examples */}
              <div className="bg-white rounded-base shadow-lg p-6">
                <h2 className="text-xl font-bold text-text-primary mb-4">Code Examples</h2>
                
                <div className="bg-bg-secondary rounded-base p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-2">Basic Usage:</p>
                    <pre className="text-xs text-text-primary overflow-x-auto bg-white p-3 rounded border border-border-secondary">
{`<Loader />`}
                    </pre>
                  </div>
                  
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-2">With Variant and Size:</p>
                    <pre className="text-xs text-text-primary overflow-x-auto bg-white p-3 rounded border border-border-secondary">
{`<Loader variant="pulse" size="lg" />`}
                    </pre>
                  </div>
                  
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-2">With Text:</p>
                    <pre className="text-xs text-text-primary overflow-x-auto bg-white p-3 rounded border border-border-secondary">
{`<Loader text="Loading employees..." />`}
                    </pre>
                  </div>
                  
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-2">Full Screen Overlay:</p>
                    <pre className="text-xs text-text-primary overflow-x-auto bg-white p-3 rounded border border-border-secondary">
{`<Loader fullScreen={true} text="Please wait..." />`}
                    </pre>
                  </div>
                  
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-2">Progress Loader:</p>
                    <pre className="text-xs text-text-primary overflow-x-auto bg-white p-3 rounded border border-border-secondary">
{`<Loader variant="progress" progress={75} text="Uploading..." />`}
                    </pre>
                  </div>
                  
                  <div>
                    <p className="text-sm font-semibold text-text-primary mb-2">Skeleton Loader:</p>
                    <pre className="text-xs text-text-primary overflow-x-auto bg-white p-3 rounded border border-border-secondary">
{`<Loader variant="skeleton" size="md" />`}
                    </pre>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full Screen Loader */}
      {showFullScreen && (
        <Loader
          size={selectedSize}
          variant={selectedVariant}
          text={showText ? 'Loading...' : ''}
          fullScreen={true}
          progress={selectedVariant === 'progress' ? progress : null}
        />
      )}
    </>
  );
};

export default LoaderTestPage;
