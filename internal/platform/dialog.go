// Package platform 封装原生对话框与外部程序调用。
package platform

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Service 平台服务。
type Service struct{ ctx context.Context }

func NewService() *Service { return &Service{} }

func (s *Service) Attach(ctx context.Context) { s.ctx = ctx }

// PickVaultDir 弹原生选目录对话框。
func (s *Service) PickVaultDir() (string, error) {
	return runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择 Markdown 库（vault）目录",
	})
}

// PickFile 选一个 .md 文件。
func (s *Service) PickFile() (string, error) {
	return runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown", Pattern: "*.md;*.markdown"},
		},
	})
}

// SaveFile 选保存路径。
func (s *Service) SaveFile(defaultName string) (string, error) {
	return runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出",
		DefaultFilename: defaultName,
	})
}
