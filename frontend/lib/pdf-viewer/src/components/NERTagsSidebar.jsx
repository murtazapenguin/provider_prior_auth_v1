import { ChevronDown, ChevronRight, Tag, X } from "lucide-react";
import { useState } from "react";
import {
  getEntityColor,
  getLighterColor,
  getUniqueEntityTags,
} from "../utils/colorUtils";

export const NERTagsSidebar = ({
  nerData,
  currentDocument,
  visibleEntityTypes,
  isVisible,
  onToggle,
  className = "",
}) => {
  const [expandedTags, setExpandedTags] = useState(new Set());

  const uniqueTags = getUniqueEntityTags(nerData);

  const toggleTag = (tag) => {
    setExpandedTags((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(tag)) {
        newSet.delete(tag);
      } else {
        newSet.add(tag);
      }
      return newSet;
    });
  };

  // Always get entities from all pages of current document
  const getTagEntities = (tag) => {
    const entities = [];
    const seenEntities = new Set();

    nerData.forEach((document) => {
      if (document.filename === currentDocument) {
        Object.values(document.data).forEach((pageEntities) => {
          pageEntities.forEach((entity) => {
            if (entity.tags && entity.tags.includes(tag)) {
              const entityKey = `${entity.entity}_${entity.entity_type}_${entity.code}`;
              if (!seenEntities.has(entityKey)) {
                seenEntities.add(entityKey);
                entities.push(entity);
              }
            }
          });
        });
      }
    });

    return entities;
  };

  if (!isVisible) {
    return (
      <div
        className={`fixed right-0 top-1/2 transform -translate-y-1/2 z-20 ${className}`}
      >
        <button
          onClick={onToggle}
          className="bg-white border border-l-0 border-gray-200 rounded-l-lg shadow-lg p-3 hover:bg-gray-50 transition-all duration-200 group"
          title="Show tags sidebar"
        >
          <Tag className="w-5 h-5 text-gray-600 group-hover:text-blue-600 transition-colors" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`bg-white border-l border-gray-200 shadow-xl flex flex-col ${className}`}
      style={{ width: "420px", height: "100%", overflowY: "auto" }}
    >
      {/* Header */}
      <div className="px-6 py-6 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Entity Tags
            </h2>
            <p className="text-gray-600">{uniqueTags.length} tags</p>
          </div>
          <button
            onClick={onToggle}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-200"
            title="Hide tags sidebar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-white">
        {uniqueTags.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Tag className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="font-medium text-gray-900 mb-2">No tags found</h3>
            <p className="text-sm text-gray-500">
              Tags will appear here when entities have tag information
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {uniqueTags.map((tag) => {
              const tagEntities = getTagEntities(tag);
              const isExpanded = expandedTags.has(tag);

              if (tagEntities.length === 0) return null;

              return (
                <div key={tag} className="space-y-2">
                  {/* Tag Section Header */}
                  <button
                    onClick={() => toggleTag(tag)}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors duration-200 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-gray-600" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-600" />
                      )}
                      <span className="text-lg font-semibold text-gray-900 capitalize">
                        {tag}
                      </span>
                      <span className="text-sm text-gray-600">
                        {tagEntities.length} entities
                      </span>
                    </div>
                  </button>

                  {/* Entities Display - UPDATED WITH ENTITY COLORS */}
                  {isExpanded && (
                    <div
                      className="ml-4"
                      style={{
                        maxHeight: "300px",
                        overflowY: "auto",
                        scrollbarWidth: "thin",
                        scrollbarColor: "#cbd5e1 #f1f5f9",
                      }}
                    >
                      {tagEntities.map((entity, index) => {
                        const isVisible = visibleEntityTypes.has(
                          entity.entity_type
                        );
                        const entityColor = getEntityColor(entity.entity_type);
                        const backgroundColor = getLighterColor(
                          entityColor,
                          0.1
                        );

                        return (
                          <div
                            key={`${entity.entity}_${entity.entity_type}_${index}`}
                            style={{
                              padding: "10px",
                              margin: "14px",
                              borderRadius: "7px",
                              cursor: "pointer",
                              textTransform: "capitalize",
                              display: "flex",
                              alignItems: "center",
                              gap: "15px",
                              backgroundColor: backgroundColor,
                              border: `1px solid ${getLighterColor(
                                entityColor,
                                0.3
                              )}`,
                              opacity: isVisible ? 1 : 0.5,
                              transition: "all 0.2s ease",
                            }}
                          >
                            {/* Entity Name and Code on same line */}
                            <div style={{ flex: 1 }}>
                              <span
                                style={{
                                  fontSize: "14px",
                                  fontWeight: "600",
                                  color: entityColor,
                                }}
                              >
                                {entity.entity}
                              </span>
                              <small
                                style={{
                                  // background: getLighterColor(entityColor, 0.2),
                                  background: "#f8f9f9",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: "700",
                                  padding: "5px",
                                  margin: "5px",
                                  textTransform: "uppercase",
                                  color: "#000",
                                  // color: entityColor,
                                  // border: `1px solid ${getLighterColor(
                                  //   entityColor,
                                  //   0.4
                                  // )}`,
                                }}
                              >
                                {entity.code}
                              </small>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
