import { Copy, ExternalLink, FileText, Hash, Tag, X } from "lucide-react";
import { getEntityColor, getLighterColor } from "../utils/colorUtils";

export const NEREntityDetails = ({
  entity,
  onClose,
  currentDocument,
  currentPage,
  className = "",
}) => {
  if (!entity) return null;

  const color = getEntityColor(entity.entity_type);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(entity.code);
  };

  const handleCopyEntity = () => {
    navigator.clipboard.writeText(entity.entity);
  };

  const handleCopyWord = () => {
    navigator.clipboard.writeText(entity.word);
  };

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-lg ${className}`}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-gray-200 rounded-t-lg"
        style={{
          backgroundColor: getLighterColor(color, 0.1),
          borderBottomColor: getLighterColor(color, 0.3),
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full border border-white"
              style={{ backgroundColor: color }}
            />
            <h3 className="font-semibold text-gray-900 capitalize">
              {entity.entity_type.replace(/_/g, " ")} Entity
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white hover:bg-opacity-50 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Main Entity Information */}
        <div className="space-y-3">
          {/* Detected Word */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <Tag className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-700 mb-1">
                Detected Word
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="px-3 py-1.5 rounded-lg font-medium text-sm border"
                  style={{
                    backgroundColor: getLighterColor(color, 0.1),
                    borderColor: getLighterColor(color, 0.3),
                    color: color,
                  }}
                >
                  "{entity.word}"
                </span>
                <button
                  onClick={handleCopyWord}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Copy word"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Full Entity Name */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-700 mb-1">
                Full Entity Name
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-900 font-medium">
                  {entity.entity}
                </span>
                <button
                  onClick={handleCopyEntity}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Copy entity name"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Entity Code */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-1">
              <Hash className="w-4 h-4 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-700 mb-1">
                Entity Code
              </div>
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-sm font-mono">
                  {entity.code}
                </code>
                <button
                  onClick={handleCopyCode}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Copy code"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  onClick={() =>
                    window.open(
                      `https://www.google.com/search?q=${encodeURIComponent(
                        entity.code + " " + entity.entity
                      )}`,
                      "_blank"
                    )
                  }
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Search online"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Entity Tags */}
          {entity.tags && entity.tags.length > 0 && (
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                <Tag className="w-4 h-4 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-700 mb-1">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1">
                  {entity.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="pt-3 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Document:</span>
              <div
                className="font-medium text-gray-900 truncate"
                title={currentDocument}
              >
                {currentDocument}
              </div>
            </div>
            <div>
              <span className="text-gray-500">Page:</span>
              <div className="font-medium text-gray-900">{currentPage}</div>
            </div>
          </div>
        </div>

        {/* Bounding Box Information */}
        <div className="pt-3 border-t border-gray-200">
          <div className="text-sm">
            <span className="text-gray-500">Position:</span>
            <div className="font-mono text-xs text-gray-600 mt-1">
              [{entity.bbox.map((coord) => coord.toFixed(4)).join(", ")}]
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
