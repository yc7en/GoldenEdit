// Package export 负责导出：单文件 HTML / PDF。
package export

import (
	"context"
	"os"
)

// Service 导出服务。
type Service struct{ ctx context.Context }

func NewService() *Service { return &Service{} }

// Exporter 二期扩展点：后续 pandoc -> DOCX/EPUB 实现此接口。
type Exporter interface {
	Format() string
	Export(src, out string) error
}

// HTML 把前端渲染好的完整 HTML（含内联 CSS）写到 out。
func (s *Service) HTML(html, out string) error {
	return os.WriteFile(out, []byte(html), 0644)
}

// PDF 导出一期占位：实际打印由前端 webview print-to-pdf 触发，
// Go 侧只负责调系统对话框选路径。
func (s *Service) PDF(html, out string) error {
	return os.WriteFile(out, []byte(html), 0644)
}
