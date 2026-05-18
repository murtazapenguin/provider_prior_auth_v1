import { useCallback, useEffect, useRef, useState } from "react";

export const AnnotationCanvas = ({
  zoom,
  annotationMode,
  annotations,
  currentPage,
  onAnnotationAdd,
}) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState([]);

  const drawAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw existing annotations for current page
    const pageAnnotations = annotations.filter(
      (ann) => ann.pageNumber === currentPage
    );

    pageAnnotations.forEach((annotation) => {
      if (annotation.points.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.thickness * zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (annotation.type === "highlighter") {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.5;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }

      ctx.moveTo(annotation.points[0].x * zoom, annotation.points[0].y * zoom);

      for (let i = 1; i < annotation.points.length; i++) {
        ctx.lineTo(
          annotation.points[i].x * zoom,
          annotation.points[i].y * zoom
        );
      }

      ctx.stroke();
    });

    // Draw current path being drawn
    if (currentPath.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle =
        annotationMode === "highlighter" ? "#FBBF24" : "#374151";
      ctx.lineWidth = (annotationMode === "highlighter" ? 20 : 2) * zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (annotationMode === "highlighter") {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.5;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }

      ctx.moveTo(currentPath[0].x * zoom, currentPath[0].y * zoom);

      for (let i = 1; i < currentPath.length; i++) {
        ctx.lineTo(currentPath[i].x * zoom, currentPath[i].y * zoom);
      }

      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, [annotations, currentPage, currentPath, zoom, annotationMode]);

  useEffect(() => {
    drawAnnotations();
  }, [drawAnnotations]);

  const getMousePos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  };

  const handleMouseDown = (e) => {
    if (annotationMode === "none") return;

    setIsDrawing(true);
    const pos = getMousePos(e);
    setCurrentPath([pos]);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || annotationMode === "none") return;

    const pos = getMousePos(e);
    setCurrentPath((prev) => [...prev, pos]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || annotationMode === "none" || currentPath.length < 2) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    const annotation = {
      id: `annotation-${Date.now()}-${Math.random()}`,
      type: annotationMode,
      points: currentPath,
      color: annotationMode === "highlighter" ? "#FBBF24" : "#374151",
      thickness: annotationMode === "highlighter" ? 20 : 2,
      pageNumber: currentPage,
    };

    onAnnotationAdd(annotation);
    setIsDrawing(false);
    setCurrentPath([]);
  };

  return (
    // <canvas
    //   ref={canvasRef}
    //   // width={width * zoom}
    //   // height={height * zoom}
    //   style={{
    //     position: "absolute",
    //     // top: 0,
    //     // left: 0,
    //     cursor: annotationMode !== "none" ? "crosshair" : "default",
    //     pointerEvents: annotationMode !== "none" ? "auto" : "none",
    //   }}
    //   onMouseDown={handleMouseDown}
    //   onMouseMove={handleMouseMove}
    //   onMouseUp={handleMouseUp}
    //   onMouseLeave={handleMouseUp}
    // />
    <></>
  );
};
