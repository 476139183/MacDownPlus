#include <stdlib.h>
#include <string.h>
#include <hoedown/document.h>
#include <hoedown/html.h>
#include "hoedown_html_patch.h"
unsigned char *macdown_render(const unsigned char *text, size_t size, unsigned mask, int flags, int toc, int smart, size_t *length) {
    const int mapping[] = {HOEDOWN_EXT_TABLES, HOEDOWN_EXT_FENCED_CODE, HOEDOWN_EXT_FOOTNOTES, HOEDOWN_EXT_AUTOLINK,
        HOEDOWN_EXT_STRIKETHROUGH, HOEDOWN_EXT_UNDERLINE, HOEDOWN_EXT_HIGHLIGHT, HOEDOWN_EXT_QUOTE,
        HOEDOWN_EXT_SUPERSCRIPT, HOEDOWN_EXT_MATH, HOEDOWN_EXT_NO_INTRA_EMPHASIS, HOEDOWN_EXT_MATH_EXPLICIT};
    int extensions = 0;
    for (unsigned i = 0; i < 12; i++) if (mask & (1u << i)) extensions |= mapping[i];
    hoedown_renderer *renderer = toc ? hoedown_html_toc_renderer_new(6) : hoedown_html_renderer_new(flags, 6);
    hoedown_html_renderer_state_extra extra = {0};
    if (toc) renderer->header = hoedown_patch_render_toc_header;
    else { renderer->blockcode = hoedown_patch_render_blockcode; renderer->listitem = hoedown_patch_render_listitem;
        ((hoedown_html_renderer_state *)renderer->opaque)->opaque = &extra; }
    hoedown_document *document = hoedown_document_new(renderer, extensions, 15);
    hoedown_buffer *buffer = hoedown_buffer_new(64); hoedown_document_render(document, buffer, text, size);
    if (smart && !toc) { hoedown_buffer *original = buffer; buffer = hoedown_buffer_new(64);
        hoedown_html_smartypants(buffer, original->data, original->size); hoedown_buffer_free(original); }
    *length = buffer->size; unsigned char *result = malloc(*length + 1);
    if (result) { memcpy(result, buffer->data, *length); result[*length] = 0; }
    hoedown_buffer_free(buffer); hoedown_document_free(document); hoedown_html_renderer_free(renderer); return result;
}
void macdown_free(void *pointer) { free(pointer); }
