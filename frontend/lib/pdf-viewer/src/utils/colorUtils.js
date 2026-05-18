// Dynamic color generation utilities for NER entities

// Generate a consistent color for any entity type using hash
function hashStringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Convert hash to HSL color
  const hue = Math.abs(hash) % 360;
  const saturation = 65 + (Math.abs(hash) % 20); // 65-85%
  const lightness = 45 + (Math.abs(hash) % 15); // 45-60%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Get color for entity type - always generate dynamically
export function getEntityColor(entityType) {
  const normalizedType = entityType.toLowerCase().trim();
  return hashStringToColor(normalizedType);
}

// Get lighter version of color for backgrounds
export function getLighterColor(color, opacity = 0.2) {
  if (color.startsWith("#")) {
    // Convert hex to rgba
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  } else if (color.startsWith("hsl")) {
    // Convert HSL to HSLA with opacity
    return color.replace("hsl", "hsla").replace(")", `, ${opacity})`);
  }

  // Fallback
  return `rgba(107, 114, 128, ${opacity})`;
}

// Get all unique entity types from NER data - Updated for new structure
export function getUniqueEntityTypes(nerData) {
  const entityTypes = new Set();

  // Handle new data structure - array of objects with filename and data
  nerData.forEach((document) => {
    Object.values(document.data).forEach((pageEntities) => {
      pageEntities.forEach((entity) => {
        if (entity.entity_type) {
          entityTypes.add(entity.entity_type);
        }
      });
    });
  });

  return Array.from(entityTypes).sort();
}

// Generate color mapping for all entity types
export function generateEntityColorMap(entityTypes) {
  const colorMap = {};

  entityTypes.forEach((entityType) => {
    colorMap[entityType] = {
      primary: getEntityColor(entityType),
      background: getLighterColor(getEntityColor(entityType), 0.2),
      border: getEntityColor(entityType),
    };
  });

  return colorMap;
}

// Get entity statistics from NER data - Updated for new structure
export function getEntityStatistics(nerData) {
  const entityCounts = {};
  let totalEntities = 0;

  // Handle new data structure
  nerData.forEach((document) => {
    Object.values(document.data).forEach((pageEntities) => {
      pageEntities.forEach((entity) => {
        entityCounts[entity.entity_type] =
          (entityCounts[entity.entity_type] || 0) + 1;
        totalEntities++;
      });
    });
  });

  return Object.entries(entityCounts)
    .map(([type, count]) => ({
      type,
      count,
      percentage: Math.round((count / totalEntities) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

// Get all unique tags from NER data
export function getUniqueEntityTags(nerData) {
  const tags = new Set();

  nerData.forEach((document) => {
    Object.values(document.data).forEach((pageEntities) => {
      pageEntities.forEach((entity) => {
        if (entity.tags && Array.isArray(entity.tags)) {
          entity.tags.forEach((tag) => tags.add(tag));
        }
      });
    });
  });

  return Array.from(tags).sort();
}

// Get entities by tag for a specific document (all pages)
export function getEntitiesByTag(nerData, tag, currentDocument) {
  const entities = [];
  const seenEntities = new Set(); // To avoid duplicates

  nerData.forEach((document) => {
    if (document.filename === currentDocument) {
      Object.values(document.data).forEach((pageEntities) => {
        pageEntities.forEach((entity) => {
          if (entity.tags && entity.tags.includes(tag)) {
            // Create a unique key to avoid duplicates
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
}
