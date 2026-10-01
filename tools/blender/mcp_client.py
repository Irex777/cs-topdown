"""Use the installed Blender MCP via its real stdio protocol.

uvx --from mcp-for-blender python tools/blender/mcp_client.py list
uvx --from mcp-for-blender python tools/blender/mcp_client.py execute path/to/script.py
uvx --from mcp-for-blender python tools/blender/mcp_client.py scene
"""
import asyncio
import json
import os
import pathlib
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    params = StdioServerParameters(
        command=os.path.expanduser('~/.local/bin/uvx'),
        args=['mcp-for-blender'],
        env={**os.environ, 'DISABLE_TELEMETRY': 'true'},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            action = sys.argv[1] if len(sys.argv) > 1 else 'scene'
            if action == 'list':
                result = await session.list_tools()
                print(json.dumps([{'name': t.name, 'inputSchema': t.inputSchema} for t in result.tools], indent=2))
                return
            if action == 'execute':
                script = pathlib.Path(sys.argv[2]).resolve()
                # runpy preserves __file__ for the asset pipeline's relative paths.
                code = f"import runpy, sys; sys.argv = [{str(script)!r}]; _build = runpy.run_path({str(script)!r}, run_name='__main__')"
                result = await session.call_tool('execute_blender_code', {'code': code, 'user_prompt': 'Build and verify Frontline game assets'})
            elif action == 'status':
                for name in ('get_hyper3d_status', 'get_hunyuan3d_status', 'get_tripo_status'):
                    status = await session.call_tool(name, {'user_prompt': 'Check availability for reference-faithful vehicle reconstruction'})
                    for content in status.content:
                        if content.type == 'text':
                            print(name, content.text)
                return
            else:
                result = await session.call_tool('get_scene_info', {'user_prompt': 'Verify the Frontline game model scene'})
            for content in result.content:
                if content.type == 'text':
                    print(content.text)
                    if content.text.startswith(('Error executing code:', 'Error getting scene info:')):
                        raise RuntimeError('Blender MCP operation failed')
            if result.isError:
                raise RuntimeError('Blender MCP reported an error')


asyncio.run(main())
